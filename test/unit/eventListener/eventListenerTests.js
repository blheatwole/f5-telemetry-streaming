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
const sinon = require('sinon');

const configWorker = require('../../../src/lib/config');
const dataPipeline = require('../../../src/lib/dataPipeline');
const EventListener = require('../../../src/lib/eventListener');
const eventListenerTestData = require('../data/eventListenerTestsData');
const logger = require('../../../src/lib/logger');
const messageStream = require('../../../src/lib/eventListener/messageStream');
const persistentStorage = require('../../../src/lib/persistentStorage');
const stubs = require('../shared/stubs');
const teemReporter = require('../../../src/lib/teemReporter');
const testAssert = require('../shared/assert');
const testUtil = require('../shared/util');
const tracer = require('../../../src/lib/utils/tracer');
const tracerMgr = require('../../../src/lib/tracerManager');
const utilMisc = require('../../../src/lib/utils/misc');

chai.use(chaiAsPromised);
const assert = chai.assert;

moduleCache.remember();

describe('Event Listener', () => {
    before(() => {
        moduleCache.restore();
    });

    describe('Message Stream', () => {
        /**
         * 'change' event is the only one 'true' way to test EventLister because
         * we are not using any other API to interact with it
         */
        let actualData;
        let coreStub;
        let origDecl;

        const defaultTestPort = 1234;
        const defaultDeclarationPort = 6514;

        const assertListener = function (actualListener, expListener) {
            assert.deepStrictEqual(actualListener.tags, expListener.tags || {});
            assert.deepStrictEqual(actualListener.actions, expListener.actions || [{
                enable: true,
                setTag: {
                    application: '`A`',
                    tenant: '`T`'
                }
            }]);
            if (expListener.hasFilterFunc) {
                assert.isNotNull(actualListener.filterFunc);
            } else {
                assert.isNull(actualListener.filterFunc);
            }
        };

        const addData = (dataPipelineArgs) => {
            const dataCtx = dataPipelineArgs[0];
            actualData[dataCtx.sourceId] = actualData[dataCtx.sourceId] || [];
            actualData[dataCtx.sourceId].push(dataCtx.data);
        };

        const gatherIds = () => {
            const ids = EventListener.getAll().map((inst) => inst.id);
            ids.sort();
            return ids;
        };

        const registeredTracerPaths = () => {
            const paths = tracerMgr.registered().map((t) => t.path);
            paths.sort();
            return paths;
        };

        beforeEach(() => {
            actualData = {};
            origDecl = {
                class: 'Telemetry',
                Listener1: {
                    class: 'Telemetry_Listener',
                    trace: [
                        { type: 'input' },
                        { type: 'output' }
                    ],
                    port: defaultTestPort,
                    tag: {
                        tenant: '`T`',
                        application: '`A`'
                    }
                }
            };

            coreStub = stubs.coreStub({
                configWorker,
                logger,
                persistentStorage,
                teemReporter,
                tracer,
                utilMisc
            });
            coreStub.utilMisc.generateUuid.numbersOnly = false;

            sinon.stub(dataPipeline, 'process').callsFake(function () {
                addData(Array.from(arguments));
                return Promise.resolve();
            });

            ['startHandler', 'stopHandler'].forEach((method) => {
                sinon.stub(messageStream.MessageStream.prototype, method).resolves();
            });

            return configWorker.processDeclaration(utilMisc.deepCopy(origDecl))
                .then(() => {
                    const listeners = EventListener.instances;
                    assert.lengthOf(Object.keys(listeners), 1);
                    assert.deepStrictEqual(gatherIds(), ['f5telemetry_default::Listener1']);
                    assertListener(listeners['f5telemetry_default::Listener1'], {
                        tags: { tenant: '`T`', application: '`A`' }
                    });
                    testAssert.sameOrderedMatches(registeredTracerPaths(), [
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener1',
                        'Telemetry_Listener.f5telemetry_default::Listener1'
                    ]);
                    assert.lengthOf(EventListener.receiversManager.getAll(), 1);
                });
        });

        afterEach(() => configWorker.emitAsync('change', { components: [], mappings: {} })
            .then(() => {
                const listeners = EventListener.getAll();
                assert.isEmpty(Object.keys(listeners));
                assert.isEmpty(EventListener.receiversManager.getAll());
            })
            .then(() => {
                sinon.restore();
            }));

        describe('events handling', () => {
            let loggerSpy;

            beforeEach(() => {
                loggerSpy = sinon.spy(EventListener.instances['f5telemetry_default::Listener1'].logger, 'exception');
            });
            eventListenerTestData.onMessagesHandler.forEach((testSet) => {
                testUtil.getCallableIt(testSet)(testSet.name, () => EventListener.receiversManager
                    .getMessageStream(defaultTestPort)
                    .emitAsync('messages', testSet.rawEvents)
                    .then(() => {
                        assert.isTrue(loggerSpy.notCalled);
                        assert.deepStrictEqual(actualData[EventListener.instances['f5telemetry_default::Listener1'].id], testSet.expectedData);
                    }));
            });
        });

        it('should create listeners with default and custom opts on config change event (no prior config)', () => {
            const newDecl = testUtil.deepCopy(origDecl);
            newDecl.Listener2 = {
                class: 'Telemetry_Listener',
                match: 'somePattern',
                trace: true
            };
            // should receive no data due filtering
            newDecl.Listener3 = {
                class: 'Telemetry_Listener',
                match: 'somePattern2',
                trace: { type: 'input', path: 'INPUT.f5telemetry_default::listener3' }
            };

            return configWorker.processDeclaration(testUtil.deepCopy(newDecl))
                .then(() => {
                    testAssert.sameOrderedMatches(registeredTracerPaths(), [
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener1',
                        'Telemetry_Listener.f5telemetry_default::Listener1',
                        'Telemetry_Listener.f5telemetry_default::Listener2',
                        'INPUT.f5telemetry_default::listener3'
                    ]);
                    assert.lengthOf(EventListener.receiversManager.getAll(), 2);
                    assert.sameDeepMembers(gatherIds(), ['f5telemetry_default::Listener1', 'f5telemetry_default::Listener2', 'f5telemetry_default::Listener3']);

                    const listeners = EventListener.instances;
                    assertListener(listeners['f5telemetry_default::Listener1'], {
                        tags: { tenant: '`T`', application: '`A`' }
                    });
                    assertListener(listeners['f5telemetry_default::Listener2'], { hasFilterFunc: true });
                    assertListener(listeners['f5telemetry_default::Listener3'], { hasFilterFunc: true });

                    return Promise.all([
                        EventListener.receiversManager.getMessageStream(defaultDeclarationPort).emitAsync('messages', ['virtual_name="somePattern"']),
                        EventListener.receiversManager.getMessageStream(defaultTestPort).emitAsync('messages', ['1234'])
                    ])
                        .then(() => assert.deepStrictEqual(actualData, {
                            [listeners['f5telemetry_default::Listener1'].id]: [{ data: '1234', originalRawData: '1234', telemetryEventCategory: 'event' }],
                            [listeners['f5telemetry_default::Listener2'].id]: [{ virtual_name: 'somePattern', telemetryEventCategory: 'LTM', originalRawData: 'virtual_name="somePattern"' }]
                        }));
                });
        });

        it('should stop existing listener(s) when removed from config', () => {
            assert.isNotEmpty(EventListener.getAll());
            assert.isNotEmpty(EventListener.receiversManager.getAll());
            return configWorker.emitAsync('change', { components: [], mappings: {} })
                .then(() => {
                    assert.isEmpty(registeredTracerPaths());
                    assert.isEmpty(EventListener.getAll());
                    assert.isEmpty(EventListener.receiversManager.getAll());
                });
        });

        it('should update existing listener(s) without restarting if port is the same', () => {
            const newDecl = testUtil.deepCopy(origDecl);
            newDecl.Listener1.trace = false;
            const updateSpy = sinon.stub(EventListener.prototype, 'updateConfig');
            const existingMessageStream = EventListener.receiversManager.registered[newDecl.Listener1.port];

            return configWorker.processDeclaration(testUtil.deepCopy(newDecl))
                .then(() => {
                    assert.isEmpty(registeredTracerPaths());
                    assert.deepStrictEqual(gatherIds(), ['f5telemetry_default::Listener1']);

                    const listeners = EventListener.instances;
                    assertListener(listeners['f5telemetry_default::Listener1'], {
                        tags: { tenant: '`T`', application: '`A`' }
                    });
                    // one for each protocol
                    assert.isTrue(updateSpy.calledOnce);

                    assert.lengthOf(EventListener.getAll(), 1);
                    assert.lengthOf(EventListener.receiversManager.getAll(), 1);

                    const currentMessageSteam = EventListener.receiversManager.getMessageStream(newDecl.Listener1.port);
                    assert.isTrue(existingMessageStream === currentMessageSteam, 'should not re-create Message Stream');

                    return existingMessageStream.emitAsync('messages', ['6514'])
                        .then(() => assert.deepStrictEqual(actualData, {
                            [listeners['f5telemetry_default::Listener1'].id]: [{ data: '6514', originalRawData: '6514', telemetryEventCategory: 'event' }]
                        }));
                });
        });

        it('should start new listener without restarting/updating existing one when processing a new namespace declaration', () => {
            const updateSpy = sinon.spy(EventListener.prototype, 'updateConfig');
            const newDecl = {
                class: 'Telemetry_Namespace',
                Listener1: {
                    class: 'Telemetry_Listener',
                    port: 2345,
                    trace: [
                        { type: 'input' },
                        { type: 'output' }
                    ]
                }
            };
            return configWorker.processNamespaceDeclaration(testUtil.deepCopy(newDecl), 'newNamespace')
                .then(() => {
                    testAssert.sameOrderedMatches(registeredTracerPaths(), [
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener1',
                        'INPUT.Telemetry_Listener.newNamespace::Listener1',
                        'Telemetry_Listener.f5telemetry_default::Listener1',
                        'Telemetry_Listener.newNamespace::Listener1'
                    ]);
                    assert.sameDeepMembers(gatherIds(), ['f5telemetry_default::Listener1', 'newNamespace::Listener1']);

                    const listeners = EventListener.instances;
                    assertListener(listeners['f5telemetry_default::Listener1'], {
                        tags: { tenant: '`T`', application: '`A`' }
                    });
                    assertListener(listeners['newNamespace::Listener1'], {});
                    // called twice - 1) constructor 2) config on change event handler
                    assert.isTrue(updateSpy.calledTwice);
                    assert.lengthOf(EventListener.getAll(), 2);
                    assert.lengthOf(EventListener.receiversManager.getAll(), 2);
                });
        });

        it('should remove disabled listener', () => {
            const newDecl = testUtil.deepCopy(origDecl);
            newDecl.Listener1.enable = false;

            return configWorker.processDeclaration(testUtil.deepCopy(newDecl))
                .then(() => {
                    assert.isEmpty(registeredTracerPaths());
                    assert.isEmpty(EventListener.getAll());
                    assert.isEmpty(EventListener.receiversManager.getAll());
                });
        });

        it('should allow another instance to listen on the same port', () => {
            const newDecl = testUtil.deepCopy(origDecl);
            newDecl.New = {
                class: 'Telemetry_Namespace',
                Listener1: {
                    class: 'Telemetry_Listener',
                    port: newDecl.Listener1.port,
                    trace: true
                }
            };

            return configWorker.processDeclaration(testUtil.deepCopy(newDecl))
                .then(() => {
                    testAssert.sameOrderedMatches(registeredTracerPaths(), [
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener1',
                        'Telemetry_Listener.New::Listener1',
                        'Telemetry_Listener.f5telemetry_default::Listener1'
                    ]);
                    assert.lengthOf(EventListener.getAll(), 2);
                    assert.lengthOf(EventListener.receiversManager.getAll(), 1);
                    assert.sameDeepMembers(gatherIds(), ['f5telemetry_default::Listener1', 'New::Listener1']);
                    const listeners = EventListener.instances;

                    return EventListener.receiversManager.getMessageStream(newDecl.Listener1.port).emitAsync('messages', ['6514'])
                        .then(() => assert.deepStrictEqual(actualData, {
                            [listeners['f5telemetry_default::Listener1'].id]: [{ data: '6514', originalRawData: '6514', telemetryEventCategory: 'event' }],
                            [listeners['New::Listener1'].id]: [{ data: '6514', originalRawData: '6514', telemetryEventCategory: 'event' }]
                        }));
                });
        });

        it('should update config of existing listener', () => {
            const newDecl = testUtil.deepCopy(origDecl);
            newDecl.Listener1 = {
                class: 'Telemetry_Listener',
                port: 9999,
                tag: {
                    tenant: 'Tenant',
                    application: 'Application'
                },
                trace: true,
                match: 'test',
                actions: [{
                    setTag: {
                        application: '`B`',
                        tenant: '`C`'
                    }
                }]
            };
            return configWorker.processDeclaration(testUtil.deepCopy(newDecl))
                .then(() => {
                    testAssert.sameOrderedMatches(registeredTracerPaths(), ['Telemetry_Listener.f5telemetry_default::Listener1']);
                    assert.lengthOf(EventListener.getAll(), 1);
                    assert.lengthOf(EventListener.receiversManager.getAll(), 1);
                    assert.deepStrictEqual(gatherIds(), ['f5telemetry_default::Listener1']);
                    const listeners = EventListener.instances;

                    assertListener(listeners['f5telemetry_default::Listener1'], {
                        tags: { tenant: 'Tenant', application: 'Application' },
                        hasFilterFunc: true,
                        actions: [{
                            enable: true,
                            setTag: {
                                application: '`B`',
                                tenant: '`C`'
                            }
                        }]
                    });

                    return EventListener.receiversManager.getMessageStream(9999).emitAsync('messages', ['virtual_name="test"'])
                        .then(() => assert.deepStrictEqual(actualData, {
                            [listeners['f5telemetry_default::Listener1'].id]: [{
                                virtual_name: 'test',
                                telemetryEventCategory: 'LTM',
                                tenant: 'Tenant',
                                originalRawData: 'virtual_name="test"',
                                application: 'Application'
                            }]
                        }));
                });
        });

        it('should set minimum and default props', () => {
            const newDecl = testUtil.deepCopy(origDecl);
            newDecl.Listener1 = {
                class: 'Telemetry_Listener'
            };
            return configWorker.processDeclaration(testUtil.deepCopy(newDecl))
                .then(() => {
                    assert.lengthOf(EventListener.getAll(), 1);
                    assert.lengthOf(EventListener.receiversManager.getAll(), 1);
                    assert.isEmpty(registeredTracerPaths());
                    assert.deepStrictEqual(gatherIds(), ['f5telemetry_default::Listener1']);
                    const listeners = EventListener.instances;

                    assertListener(listeners['f5telemetry_default::Listener1'], {});

                    return EventListener.receiversManager.getMessageStream(defaultDeclarationPort).emitAsync('messages', ['data'])
                        .then(() => assert.deepStrictEqual(actualData, {
                            [listeners['f5telemetry_default::Listener1'].id]: [{
                                data: 'data',
                                originalRawData: 'data',
                                telemetryEventCategory: 'event'
                            }]
                        }));
                });
        });

        it('should try to restart data receiver 10 times', () => {
            const msStartSpy = sinon.spy(messageStream.MessageStream.prototype, 'restart');
            messageStream.MessageStream.prototype.startHandler.rejects(new Error('test error'));

            const newDecl = testUtil.deepCopy(origDecl);
            newDecl.Listener1 = {
                class: 'Telemetry_Listener',
                port: 9999,
                tag: {
                    tenant: 'Tenant',
                    application: 'Application'
                },
                trace: true,
                match: 'test',
                actions: [{
                    setTag: {
                        application: '`B`',
                        tenant: '`C`'
                    }
                }]
            };
            return configWorker.processDeclaration(testUtil.deepCopy(newDecl))
                .then(() => {
                    assert.strictEqual(msStartSpy.callCount, 10);
                });
        });

        it('should destroy all registered data receivers', () => {
            const receivers = [
                EventListener.receiversManager.getMessageStream(6514),
                EventListener.receiversManager.getMessageStream(6515)
            ];
            return Promise.all(receivers.map((r) => r.start()))
                .then(() => {
                    receivers.forEach((r) => assert.isTrue(r.isRunning(), 'should be in running state'));
                    return EventListener.receiversManager.destroyAll();
                })
                .then(() => {
                    receivers.forEach((r) => assert.isTrue(r.isDestroyed(), 'should be destroyed'));
                    assert.deepStrictEqual(EventListener.receiversManager.registered, {}, 'should have no registered receivers');
                });
        });

        it('should enable/disable input tracing', () => {
            const getTracerData = (tracerPath) => coreStub.tracer.data[
                Object.keys(coreStub.tracer.data).find((key) => key.indexOf(tracerPath) !== -1)
            ].map((d) => d.data);

            const newDecl = testUtil.deepCopy(origDecl);
            newDecl.Listener2 = {
                class: 'Telemetry_Listener',
                trace: [
                    { type: 'input' },
                    { type: 'output' }
                ]
            };
            newDecl.Listener3 = {
                class: 'Telemetry_Listener',
                trace: [
                    { type: 'input' },
                    { type: 'output' }
                ]
            };
            newDecl.Listener4 = {
                class: 'Telemetry_Listener',
                trace: [
                    { type: 'input' },
                    { type: 'output' }
                ]
            };
            return configWorker.processDeclaration(testUtil.deepCopy(newDecl))
                .then(() => {
                    testAssert.sameOrderedMatches(registeredTracerPaths(), [
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener1',
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener2',
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener3',
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener4',
                        'Telemetry_Listener.f5telemetry_default::Listener1',
                        'Telemetry_Listener.f5telemetry_default::Listener2',
                        'Telemetry_Listener.f5telemetry_default::Listener3',
                        'Telemetry_Listener.f5telemetry_default::Listener4'
                    ]);

                    return Promise.all([
                        EventListener.receiversManager.getMessageStream(defaultDeclarationPort).emitAsync('rawData', {
                            data: Buffer.from('12345'),
                            senderKey: 'senderKey',
                            protocol: 'tcp',
                            timestamp: 0,
                            hrtime: [0, 0]
                        }),
                        EventListener.receiversManager.getMessageStream(defaultTestPort).emitAsync('rawData', {
                            data: Buffer.from('12345'),
                            senderKey: 'senderKey',
                            protocol: 'udp',
                            timestamp: 0,
                            hrtime: [0, 0]
                        })
                    ]);
                })
                .then(() => coreStub.tracer.waitForData())
                .then(() => {
                    assert.deepStrictEqual(
                        getTracerData('INPUT.Telemetry_Listener.f5telemetry_default::Listener1'),
                        [{
                            data: Buffer.from('12345').toString('hex'), // in hex
                            hrtime: [0, 0],
                            protocol: 'udp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        }]
                    );
                    [
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener2',
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener3',
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener4'
                    ].forEach((tracerPath) => assert.deepStrictEqual(
                        getTracerData(tracerPath),
                        [{
                            data: Buffer.from('12345').toString('hex'), // in hex
                            hrtime: [0, 0],
                            protocol: 'tcp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        }]
                    ));
                    delete newDecl.Listener4;
                    return configWorker.processDeclaration(testUtil.deepCopy(newDecl));
                })
                .then(() => Promise.all([
                    EventListener.receiversManager.getMessageStream(defaultDeclarationPort).emitAsync('rawData', {
                        data: Buffer.from('6789'),
                        senderKey: 'senderKey',
                        protocol: 'tcp',
                        timestamp: 0,
                        hrtime: [0, 0]
                    }),
                    EventListener.receiversManager.getMessageStream(defaultTestPort).emitAsync('rawData', {
                        data: Buffer.from('6789'),
                        senderKey: 'senderKey',
                        protocol: 'udp',
                        timestamp: 0,
                        hrtime: [0, 0]
                    })
                ]))
                .then(() => coreStub.tracer.waitForData())
                .then(() => {
                    assert.includeDeepMembers(
                        getTracerData('INPUT.Telemetry_Listener.f5telemetry_default::Listener1'),
                        [{
                            data: Buffer.from('6789').toString('hex'), // in hex
                            hrtime: [0, 0],
                            protocol: 'udp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        }]
                    );
                    [
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener2',
                        'INPUT.Telemetry_Listener.f5telemetry_default::Listener3'
                    ].forEach((tracerPath) => assert.includeDeepMembers(
                        getTracerData(tracerPath),
                        [{
                            data: Buffer.from('6789').toString('hex'), // in hex
                            hrtime: [0, 0],
                            protocol: 'tcp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        }]
                    ));
                    assert.sameDeepMembers(
                        getTracerData('INPUT.Telemetry_Listener.f5telemetry_default::Listener4'),
                        [{
                            data: Buffer.from('12345').toString('hex'), // in hex
                            hrtime: [0, 0],
                            protocol: 'tcp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        }],
                        'should not write raw data to from disabled listener'
                    );
                    newDecl.Listener3.trace = { type: 'output' };
                    return configWorker.processDeclaration(testUtil.deepCopy(newDecl));
                })
                .then(() => Promise.all([
                    EventListener.receiversManager.getMessageStream(defaultDeclarationPort).emitAsync('rawData', {
                        data: Buffer.from('ABC'),
                        senderKey: 'senderKey',
                        protocol: 'tcp',
                        timestamp: 0,
                        hrtime: [0, 0]
                    }),
                    EventListener.receiversManager.getMessageStream(defaultTestPort).emitAsync('rawData', {
                        data: Buffer.from('ABC'),
                        senderKey: 'senderKey',
                        protocol: 'udp',
                        timestamp: 0,
                        hrtime: [0, 0]
                    })
                ]))
                .then(() => coreStub.tracer.waitForData())
                .then(() => {
                    assert.includeDeepMembers(
                        getTracerData('INPUT.Telemetry_Listener.f5telemetry_default::Listener1'),
                        [{
                            data: Buffer.from('ABC').toString('hex'), // in hex
                            hrtime: [0, 0],
                            protocol: 'udp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        }]
                    );
                    assert.includeDeepMembers(
                        getTracerData('INPUT.Telemetry_Listener.f5telemetry_default::Listener2'),
                        [{
                            data: Buffer.from('ABC').toString('hex'), // in hex
                            hrtime: [0, 0],
                            protocol: 'tcp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        }]
                    );
                    assert.notDeepInclude(
                        getTracerData('INPUT.Telemetry_Listener.f5telemetry_default::Listener3'),
                        {
                            data: Buffer.from('ABC').toString('hex'), // in hex
                            hrtime: [0, 0],
                            protocol: 'tcp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        },
                        'should not write raw data to from disabled listener'
                    );
                    assert.sameDeepMembers(
                        getTracerData('INPUT.Telemetry_Listener.f5telemetry_default::Listener4'),
                        [{
                            data: '3132333435', // in hex
                            hrtime: [0, 0],
                            protocol: 'tcp',
                            senderKey: 'senderKey',
                            timestamp: 0
                        }],
                        'should not write raw data to from disabled listener'
                    );
                    newDecl.Listener1.trace = { type: 'output' };
                    newDecl.Listener2.trace = { type: 'output' };
                    return configWorker.processDeclaration(testUtil.deepCopy(newDecl));
                })
                .then(() => Promise.all([
                    EventListener.receiversManager.getMessageStream(defaultDeclarationPort).emitAsync('rawData', {
                        data: Buffer.from('final'),
                        senderKey: 'senderKey',
                        protocol: 'tcp',
                        timestamp: 0,
                        hrtime: [0, 0]
                    }),
                    EventListener.receiversManager.getMessageStream(defaultTestPort).emitAsync('rawData', {
                        data: Buffer.from('final'),
                        senderKey: 'senderKey',
                        protocol: 'udp',
                        timestamp: 0,
                        hrtime: [0, 0]
                    })
                ]))
                .then(() => coreStub.tracer.waitForData())
                .then(() => [
                    'INPUT.Telemetry_Listener.f5telemetry_default::Listener1',
                    'INPUT.Telemetry_Listener.f5telemetry_default::Listener2',
                    'INPUT.Telemetry_Listener.f5telemetry_default::Listener3',
                    'INPUT.Telemetry_Listener.f5telemetry_default::Listener4'
                ].forEach((tracerPath) => assert.notDeepInclude(
                    getTracerData(tracerPath),
                    {
                        data: Buffer.from('final').toString('hex'), // in hex
                        hrtime: [0, 0],
                        protocol: tracerPath.indexOf('f5telemetry_default::Listener1') !== -1 ? 'udp' : 'tcp',
                        senderKey: 'senderKey',
                        timestamp: 0
                    },
                    'should not write raw data to from disabled listener'
                )));
        });
    });
});
