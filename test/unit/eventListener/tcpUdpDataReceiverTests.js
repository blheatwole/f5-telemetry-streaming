/*
 * Copyright 2022. F5 Networks, Inc. See End User License Agreement ('EULA') for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

/* eslint-disable import/order */
const moduleCache = require('../shared/restoreCache')();

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const EventEmitter = require('events').EventEmitter;
const sinon = require('sinon');
const net = require('net');
const udp = require('dgram');

const tcpUdpDataReceiver = require('../../../src/lib/eventListener/tcpUdpDataReceiver');
const stubs = require('../shared/stubs');

chai.use(chaiAsPromised);
const assert = chai.assert;

moduleCache.remember();

describe('TCP and UDP Receivers', () => {
    let clock;
    let dataCallbackSpy;
    let receiverInst;

    const testPort = 6514;
    const testAddr = 'localhost10';
    const testAddr6 = '::localhost10';

    before(() => {
        moduleCache.restore();
    });

    beforeEach(() => {
        sinon.stub(tcpUdpDataReceiver.TcpUdpBaseDataReceiver, 'RESTART_DELAY').value(1);
        clock = stubs.clock();
        dataCallbackSpy = sinon.spy();
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('TcpUdpBaseDataReceiver', () => {
        beforeEach(() => {
            receiverInst = new tcpUdpDataReceiver.TcpUdpBaseDataReceiver(
                testPort,
                { address: testAddr }
            );
            receiverInst.on('data', dataCallbackSpy);
        });

        describe('abstract methods', () => {
            beforeEach(() => {
                sinon.restore();
            });

            ['getConnKey'].forEach((method) => {
                it(`.${method}()`, () => {
                    assert.throws(
                        () => receiverInst[method](),
                        /Not implemented/,
                        'should throw "Not implemented" error'
                    );
                });
            });
        });

        describe('safeRestart', () => {
            it('should not fail when .restart() rejects', () => {
                sinon.stub(receiverInst, 'restart').rejects(new Error('restart error'));
                return assert.isFulfilled(receiverInst.safeRestart());
            });

            it('should not fail when .restart() throws error', () => {
                sinon.stub(receiverInst, 'restart').throws(new Error('restart error'));
                return assert.isFulfilled(receiverInst.safeRestart());
            });
        });
    });

    describe('TCPDataReceiver', () => {
        class MockSocket extends EventEmitter {
            destroy() {
                this.emit('destroyMock', this);
            }
        }
        class MockServer extends EventEmitter {
            setInitArgs(opts) {
                this.opts = opts;
            }

            listen() {
                this.emit('listenMock', this, Array.from(arguments));
            }

            close() {
                this.emit('closeMock', this, Array.from(arguments));
            }
        }

        let createServerMockCb;

        beforeEach(() => {
            receiverInst = new tcpUdpDataReceiver.TCPDataReceiver(testPort, { address: testAddr });
            receiverInst.on('data', dataCallbackSpy);

            sinon.stub(net, 'createServer').callsFake(function () {
                const serverMock = new MockServer();
                serverMock.setInitArgs.apply(serverMock, arguments);
                if (createServerMockCb) {
                    createServerMockCb(serverMock);
                }
                return serverMock;
            });
        });

        afterEach(() => {
            createServerMockCb = null;
        });

        describe('"data" event', () => {
            let socketId = 0;
            let serverMock;

            const createMockSocket = () => {
                socketId += 1;
                const socketMock = new MockSocket();
                socketMock.remoteAddress = testAddr;
                socketMock.remotePort = testPort + socketId;
                return socketMock;
            };

            beforeEach(() => {
                createServerMockCb = (newServerMock) => {
                    serverMock = newServerMock;
                    serverMock.on('listenMock', () => serverMock.emit('listening'));
                    serverMock.on('closeMock', (inst, args) => {
                        serverMock.emit('close');
                        args[0](); // call callback
                    });
                };
            });

            afterEach(() => {
                serverMock = null;
            });

            it('should emit "data" event when received data', () => {
                const expectedData = [];
                return receiverInst.start()
                    .then(() => {
                        const socket1 = createMockSocket();
                        expectedData.push(receiverInst.getConnKey(socket1));
                        serverMock.emit('connection', socket1);

                        const socket2 = createMockSocket();
                        expectedData.push(receiverInst.getConnKey(socket2));
                        serverMock.emit('connection', socket2);

                        socket1.emit('data', expectedData[0]);
                        socket2.emit('data', expectedData[1]);
                        return receiverInst.stop();
                    })
                    .then(() => {
                        assert.deepStrictEqual(dataCallbackSpy.args, [
                            [expectedData[0], expectedData[0], 0, [0, 0]],
                            [expectedData[1], expectedData[1], 0, [0, 0]]
                        ]);
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                        assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.TCPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                    });
            });
        });

        describe('.getConnKey()', () => {
            it('should compute unique key', () => {
                assert.strictEqual(receiverInst.getConnKey({ remoteAddress: testAddr, remotePort: testPort }), `tcp-${testAddr}-${testPort}`);
            });
        });

        describe('.start()', () => {
            it('should start receiver', () => {
                let serverMock;
                createServerMockCb = (newServerMock) => {
                    serverMock = newServerMock;
                    serverMock.on('listenMock', (inst, args) => {
                        assert.deepStrictEqual(args[0], { port: testPort, address: testAddr }, 'should match listen options');
                        serverMock.emit('listening');
                    });
                };
                return receiverInst.start()
                    .then(() => {
                        assert.isTrue(receiverInst.isRunning(), 'should be in running state');
                        assert.deepStrictEqual(serverMock.opts, { allowHalfOpen: false, pauseOnConnect: false }, 'should match server options');
                    });
            });

            it('should fail to start when socket was closed before become active', () => {
                createServerMockCb = (serverMock) => {
                    serverMock.on('listenMock', () => {
                        serverMock.emit('close');
                    });
                };
                return assert.isRejected(receiverInst.start(), /socket closed before/)
                    .then(() => {
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    });
            });

            it('should fail to start when error raised before socket become active', () => {
                createServerMockCb = (serverMock) => {
                    serverMock.on('listenMock', () => {
                        serverMock.emit('error', new Error('test error'));
                    });
                };
                return assert.isRejected(receiverInst.start(), /test error/)
                    .then(() => {
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    });
            });

            it('should restart receiver when caught error', () => {
                const closeSpy = sinon.spy((inst, args) => {
                    inst.emit('close');
                    args[0]();
                });
                const listenSpy = sinon.spy((inst) => {
                    inst.emit('listening');
                    setTimeout(() => {
                        inst.emit('error', new Error('test error'));
                    }, 10);
                });
                createServerMockCb = (serverMock) => {
                    serverMock.on('listenMock', listenSpy);
                    serverMock.on('closeMock', closeSpy);
                };

                clock.clockForward(5, { promisify: true });
                return new Promise((resolve, reject) => {
                    const originSafeRestart = receiverInst.safeRestart.bind(receiverInst);
                    sinon.stub(receiverInst, 'safeRestart')
                        .callsFake(() => originSafeRestart()) // listen #2 and listen #3, close #1 and close #2
                        .onThirdCall().callsFake(() => {
                            receiverInst.destroy().then(resolve).catch(reject); // close #3
                            return originSafeRestart();
                        });
                    receiverInst.start() // listen #1
                        .catch(reject);
                })
                    .then(() => {
                        assert.strictEqual(closeSpy.callCount, 3, 'should call socket.close 3 times');
                        assert.strictEqual(listenSpy.callCount, 3, 'should call socket.listen 3 times');
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                        assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.TCPDataReceiver.STATE.DESTROYED), 'should have DESTROYED state');
                    });
            });
        });

        describe('.stop()', () => {
            let serverMock;

            beforeEach(() => {
                createServerMockCb = (newServerMock) => {
                    serverMock = newServerMock;
                    serverMock.on('listenMock', () => serverMock.emit('listening'));
                    serverMock.on('closeMock', (inst, args) => {
                        serverMock.emit('close');
                        args[0](); // call callback
                    });
                };
            });

            afterEach(() => {
                serverMock = null;
            });

            it('should be able to stop receiver without active socket', () => receiverInst.stop()
                .then(() => {
                    assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.TCPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                }));

            it('should be able to stop receiver', () => receiverInst.start()
                .then(receiverInst.stop.bind(receiverInst))
                .then(() => {
                    assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.TCPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                }));

            it('should close all opened connections', () => {
                const sockets = [];
                const createMockSocket = () => {
                    const socketMock = new MockSocket();
                    socketMock.remoteAddress = testAddr;
                    socketMock.remotePort = testPort + sockets.length;
                    socketMock.destroy = sinon.spy(() => {
                        socketMock.emit('close');
                    });
                    sockets.push(socketMock);
                    return socketMock;
                };
                return receiverInst.start()
                    .then(() => {
                        for (let i = 0; i < 10; i += 1) {
                            serverMock.emit('connection', createMockSocket());
                        }
                        // close first socket to check that socket was removed from list
                        sockets[0].emit('close');
                        // should call socket.destroy and remove socket from list too
                        sockets[1].emit('error');
                        return receiverInst.stop();
                    })
                    .then(() => {
                        assert.strictEqual(sockets[0].destroy.callCount, 0, 'should not call socket.destroy for closed socket');
                        sockets.slice(1).forEach((socketMock) => {
                            assert.strictEqual(socketMock.destroy.callCount, 1, 'should call socket.destroy just once for each socket');
                        });
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                        assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.TCPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                    });
            });
        });
    });

    describe('UDPDataReceiver', () => {
        class MockServer extends EventEmitter {
            setInitArgs(opts) {
                this.opts = opts;
            }

            bind() {
                this.emit('listenMock', this, Array.from(arguments));
            }

            close() {
                this.emit('closeMock', this, Array.from(arguments));
            }
        }

        let createServerMockCb;

        beforeEach(() => {
            receiverInst = new tcpUdpDataReceiver.UDPDataReceiver(testPort, { address: testAddr });
            receiverInst.on('data', dataCallbackSpy);

            sinon.stub(udp, 'createSocket').callsFake(function () {
                const serverMock = new MockServer();
                serverMock.setInitArgs.apply(serverMock, arguments);
                if (createServerMockCb) {
                    createServerMockCb(serverMock);
                }
                return serverMock;
            });
        });

        afterEach(() => {
            createServerMockCb = null;
        });

        describe('"data" event', () => {
            let socketId = 0;
            let serverMock;

            const createSocketInfo = () => {
                socketId += 1;
                return {
                    address: testAddr,
                    port: testPort + socketId
                };
            };

            beforeEach(() => {
                createServerMockCb = (newServerMock) => {
                    serverMock = newServerMock;
                    serverMock.on('listenMock', () => serverMock.emit('listening'));
                    serverMock.on('closeMock', (inst, args) => {
                        serverMock.emit('close');
                        args[0](); // call callback
                    });
                };
            });

            afterEach(() => {
                serverMock = null;
            });

            it('should emit "data" event when received data', () => {
                const expectedData = [];
                return receiverInst.start()
                    .then(() => {
                        const socketInfo1 = createSocketInfo();
                        expectedData.push(receiverInst.getConnKey(socketInfo1));
                        serverMock.emit('message', expectedData[0], socketInfo1);

                        const socketInfo2 = createSocketInfo();
                        expectedData.push(receiverInst.getConnKey(socketInfo2));
                        serverMock.emit('message', expectedData[1], socketInfo2);

                        return receiverInst.stop();
                    })
                    .then(() => {
                        assert.deepStrictEqual(dataCallbackSpy.args, [
                            [expectedData[0], expectedData[0], 0, [0, 0]],
                            [expectedData[1], expectedData[1], 0, [0, 0]]
                        ]);
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                        assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.UDPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                    });
            });
        });

        describe('.getConnKey()', () => {
            it('should compute unique key', () => {
                assert.strictEqual(receiverInst.getConnKey({ address: testAddr, port: testPort }), `udp4-${testAddr}-${testPort}`);
            });
        });

        describe('.start()', () => {
            it('should start receiver (udp4 by default)', () => {
                let serverMock;
                createServerMockCb = (newServerMock) => {
                    serverMock = newServerMock;
                    serverMock.on('listenMock', (inst, args) => {
                        assert.deepStrictEqual(args[0], { port: testPort, address: testAddr }, 'should match listen options');
                        serverMock.emit('listening');
                    });
                };
                return receiverInst.start()
                    .then(() => {
                        assert.isTrue(receiverInst.isRunning(), 'should be in running state');
                        assert.deepStrictEqual(serverMock.opts, { type: 'udp4', ipv6Only: false, reuseAddr: true }, 'should match socket options');
                    });
            });

            it('should start receiver (udp6)', () => {
                let serverMock;
                createServerMockCb = (newServerMock) => {
                    serverMock = newServerMock;
                    serverMock.on('listenMock', (inst, args) => {
                        assert.deepStrictEqual(args[0], { port: testPort, address: testAddr }, 'should match listen options');
                        serverMock.emit('listening');
                    });
                };
                receiverInst = new tcpUdpDataReceiver.UDPDataReceiver(testPort, { address: testAddr }, 'udp6');
                return receiverInst.start()
                    .then(() => {
                        assert.isTrue(receiverInst.isRunning(), 'should be in running state');
                        assert.deepStrictEqual(serverMock.opts, { type: 'udp6', ipv6Only: true, reuseAddr: true }, 'should match socket options');
                    });
            });

            it('should fail to start when socket was closed before become active', () => {
                createServerMockCb = (serverMock) => {
                    serverMock.on('listenMock', () => {
                        serverMock.emit('close');
                    });
                };
                return assert.isRejected(receiverInst.start(), /socket closed before/)
                    .then(() => {
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    });
            });

            it('should fail to start when error raised before socket become active', () => {
                createServerMockCb = (serverMock) => {
                    serverMock.on('listenMock', () => {
                        serverMock.emit('error', new Error('test error'));
                    });
                };
                return assert.isRejected(receiverInst.start(), /test error/)
                    .then(() => {
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    });
            });

            it('should restart receiver when caught error', () => {
                const closeSpy = sinon.spy((inst, args) => {
                    inst.emit('close');
                    args[0]();
                });
                const listenSpy = sinon.spy((inst) => {
                    inst.emit('listening');
                    setTimeout(() => {
                        inst.emit('error', new Error('test error'));
                    }, 10);
                });
                createServerMockCb = (serverMock) => {
                    serverMock.on('listenMock', listenSpy);
                    serverMock.on('closeMock', closeSpy);
                };

                clock.clockForward(5, { promisify: true });
                return new Promise((resolve, reject) => {
                    const originSafeRestart = receiverInst.safeRestart.bind(receiverInst);
                    sinon.stub(receiverInst, 'safeRestart')
                        .callsFake(() => originSafeRestart()) // listen #2 and listen #3, close #1 and close #2
                        .onThirdCall().callsFake(() => {
                            receiverInst.destroy().then(resolve).catch(reject); // close #3
                            return originSafeRestart();
                        });
                    receiverInst.start() // listen #1
                        .catch(reject);
                })
                    .then(() => {
                        assert.strictEqual(closeSpy.callCount, 3, 'should call socket.close 3 times');
                        assert.strictEqual(listenSpy.callCount, 3, 'should call socket.listen 3 times');
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                        assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.UDPDataReceiver.STATE.DESTROYED), 'should have DESTROYED state');
                    });
            });
        });

        describe('.stop()', () => {
            let serverMock;

            beforeEach(() => {
                createServerMockCb = (newServerMock) => {
                    serverMock = newServerMock;
                    serverMock.on('listenMock', () => serverMock.emit('listening'));
                    serverMock.on('closeMock', (inst, args) => {
                        serverMock.emit('close');
                        args[0](); // call callback
                    });
                };
            });

            afterEach(() => {
                serverMock = null;
            });

            it('should be able to stop receiver without active socket', () => receiverInst.stop()
                .then(() => {
                    assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.UDPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                }));

            it('should be able to stop receiver', () => receiverInst.start()
                .then(receiverInst.stop.bind(receiverInst))
                .then(() => {
                    assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.UDPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                }));
        });
    });

    describe('DualUDPDataReceiver', () => {
        class MockServer extends EventEmitter {
            setInitArgs(opts) {
                this.opts = opts;
            }

            bind() {
                this.emit('listenMock', this, Array.from(arguments));
            }

            close() {
                this.emit('closeMock', this, Array.from(arguments));
            }
        }

        let serverMocks;
        let onMockCreatedCallback;
        const getServerMock = (ipv6) => serverMocks.find((mock) => (ipv6 && mock.opts.type === 'udp6') || (!ipv6 && mock.opts.type === 'udp4'));

        beforeEach(() => {
            serverMocks = [];
            receiverInst = new tcpUdpDataReceiver.DualUDPDataReceiver(testPort, { address: testAddr });
            receiverInst.on('data', dataCallbackSpy);

            sinon.stub(udp, 'createSocket').callsFake(function () {
                const mock = new MockServer();
                mock.setInitArgs.apply(mock, arguments);
                serverMocks.push(mock);
                if (onMockCreatedCallback) {
                    onMockCreatedCallback(mock);
                }
                return mock;
            });
            onMockCreatedCallback = (serverMock) => {
                serverMock.on('listenMock', () => serverMock.emit('listening'));
                serverMock.on('closeMock', (inst, args) => {
                    serverMock.emit('close');
                    args[0](); // call callback
                });
            };
        });

        describe('abstract methods', () => {
            beforeEach(() => {
                sinon.restore();
            });

            ['getConnKey'].forEach((method) => {
                it(`.${method}()`, () => {
                    assert.throws(
                        () => receiverInst[method](),
                        /Not implemented/,
                        'should throw "Not implemented" error'
                    );
                });
            });
        });

        describe('"data" event', () => {
            let socketId = 0;
            const createSocketInfo = (ipv6) => {
                socketId += 1;
                return {
                    address: ipv6 ? testAddr6 : testAddr,
                    port: testPort + socketId
                };
            };

            it('should emit "data" event when received data', () => {
                const expectedData = [];
                return receiverInst.start()
                    .then(() => {
                        const socketInfo1 = createSocketInfo();
                        expectedData.push(receiverInst._receivers[0].getConnKey(socketInfo1));
                        getServerMock().emit('message', expectedData[0], socketInfo1);

                        const socketInfo2 = createSocketInfo(true);
                        expectedData.push(receiverInst._receivers[1].getConnKey(socketInfo2));
                        getServerMock(true).emit('message', expectedData[1], socketInfo2);

                        return receiverInst.stop();
                    })
                    .then(() => {
                        assert.sameDeepMembers(dataCallbackSpy.args, [
                            [expectedData[0], expectedData[0], 0, [0, 0]],
                            [expectedData[1], expectedData[1], 0, [0, 0]]
                        ]);
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                        assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.DualUDPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                    });
            });
        });

        describe('.restart()', () => {
            it('should recrate all receivers on restart', () => receiverInst.start()
                .then(() => {
                    assert.lengthOf(serverMocks, 2, 'should create 2 sockets');
                    assert.strictEqual(getServerMock().opts.type, 'udp4', 'should create udp4 listener');
                    assert.strictEqual(getServerMock(true).opts.type, 'udp6', 'should create udp6 listener');
                    return receiverInst.restart();
                })
                .then(() => {
                    assert.lengthOf(serverMocks, 4, 'should create 2 more sockets');
                    assert.lengthOf(serverMocks.filter((mock) => mock.opts.type === 'udp4'), 2, 'should have 2 udp4 sockets');
                    assert.lengthOf(serverMocks.filter((mock) => mock.opts.type === 'udp6'), 2, 'should have 2 udp6 sockets');
                }));
        });

        describe('.start()', () => {
            it('should start receivers', () => receiverInst.start()
                .then(() => {
                    assert.lengthOf(serverMocks, 2, 'should create 2 sockets');
                    assert.strictEqual(getServerMock().opts.type, 'udp4', 'should create udp4 listener');
                    assert.strictEqual(getServerMock(true).opts.type, 'udp6', 'should create udp6 listener');
                    assert.isTrue(receiverInst.isRunning(), 'should be in running state');
                }));

            it('should fail to start', () => {
                let firstOnly = false;
                onMockCreatedCallback = (serverMock) => {
                    if (!firstOnly) {
                        firstOnly = true;
                        serverMock.on('listenMock', () => {
                            serverMock.emit('close');
                        });
                    } else {
                        serverMock.on('listenMock', () => serverMock.emit('listening'));
                    }
                };
                return assert.isRejected(receiverInst.start(), /socket closed before/)
                    .then(() => {
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    });
            });
        });

        describe('.stop()', () => {
            it('should be able to stop receiver without active socket', () => receiverInst.stop()
                .then(() => {
                    assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                    assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.DualUDPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                }));

            it('should be able to stop receiver', () => {
                const closeSpy = sinon.spy();
                return receiverInst.start()
                    .then(() => {
                        assert.isTrue(receiverInst.hasReceivers(), 'should have receivers started');
                        getServerMock().on('close', closeSpy);
                        getServerMock(true).on('close', closeSpy);
                        return receiverInst.stop();
                    })
                    .then(() => {
                        assert.strictEqual(closeSpy.callCount, 2, 'should close 2 sockets');
                        assert.isFalse(receiverInst.isRunning(), 'should not be in running state');
                        assert.isTrue(receiverInst.hasState(tcpUdpDataReceiver.DualUDPDataReceiver.STATE.STOPPED), 'should have STOPPED state');
                    });
            });
        });
    });
});
