/*
 * Copyright 2022. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

/* eslint-disable import/order */
const moduleCache = require('./shared/restoreCache')();

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');

const logger = require('../../src/lib/logger');
const stubs = require('./shared/stubs');

chai.use(chaiAsPromised);
const assert = chai.assert;

moduleCache.remember();

describe('Logger', () => {
    const logLevels = [
        'notset',
        'debug',
        'info',
        'warning',
        'error'
    ];

    let coreStub;

    before(() => {
        moduleCache.restore();
    });

    beforeEach(() => {
        coreStub = stubs.coreStub({
            logger
        }, {
            logger: {
                setToDebug: false,
                ignoreLevelChange: false
            }
        });
    });

    afterEach(() => {
        logger.setLogLevel('info');
        sinon.restore();
    });

    it('defaults: should be by default \'info\' level', () => {
        assert.strictEqual(logger.getLevelName(), 'info');
    });

    it('should ignore unsupported type on attempt to set log level', () => {
        assert.strictEqual(logger.getLevelName(), 'info');
        logger.setLogLevel({});
        assert.strictEqual(logger.getLevelName(), 'info');
    });

    it('should add log message on every level change', () => {
        let count = 0;
        logLevels.forEach((logLevelName) => {
            logger.setLogLevel(logLevelName);
            count += 1;
            assert.lengthOf(coreStub.logger.messages.info, count);
        });
    });

    it('should return appropriate log level value for standard value', () => {
        logLevels.forEach((logLevelName) => {
            [logLevelName, logger.getLevel(logLevelName)].forEach((value) => {
                logger.setLogLevel(value);
                assert.strictEqual(logger.getLevelName(), logLevelName);
                assert.strictEqual(logger.getLevel(), logger.getLevel(logLevelName));
                assert.strictEqual(logger.getLevel(), logger.getLevel(logger.getLevelName()));
            });
        });
    });

    it('should log error message on attempt to set invalid logLevelName', () => {
        const invalidName = 'invalidErrorLevelName';
        logger.setLogLevel(invalidName);

        assert.lengthOf(coreStub.logger.messages.error, 1);
        assert.include(coreStub.logger.messages.error[0], invalidName);
    });

    it('should return appropriate log level name for non-standard value', () => {
        const value = 9999;
        const desiredName = `Level ${value}`;

        logger.setLogLevel(value);
        assert.strictEqual(logger.getLevelName(), desiredName);
        assert.strictEqual(logger.getLevelName(value), desiredName);
    });

    logLevels.forEach((logLevel) => {
        ['debug', 'error', 'info', 'warning'].forEach((logType) => {
            it(`should log at the appropriate '${logType}' level and preserve global '${logLevel}' level`, () => {
                // this call logs message about level change, so we already have 1 item in coreStub.logger.messages.info
                logger.setLogLevel(logLevel);
                coreStub.logger.messages.info = [];

                const msg = `this is a ${logType} message`;
                logger[logType](msg);

                if (logger.getLevel(logType) >= logger.getLevel()) {
                    assert.lengthOf(coreStub.logger.messages[logType], 1);
                    // check it contains the message - no exact match as prefix [telemetry] will be added
                    assert.include(coreStub.logger.messages[logType][0], msg);
                } else {
                    assert.isEmpty(coreStub.logger.messages[logType]);
                }
            });
        });
    });

    it('should not log error and exception messages when level is too high', () => {
        coreStub.logger.messages.error = [];
        logger.setLogLevel(100);

        logger.error('should not log this message');
        logger.exception('should not log this message');
        assert.isEmpty(coreStub.logger.messages.error, 'should not log error messages when level is too high');
    });

    it('should log an exception', () => {
        const msgType = 'exception';
        logger.exception(`this is a ${msgType} message`, new Error('foo'));
        logger.debugException(`this is a ${msgType} message`, new Error('foo'));

        assert.lengthOf(coreStub.logger.messages.error, 1);
        assert.isEmpty(coreStub.logger.messages.debug);
        assert.include(coreStub.logger.messages.error[0], `this is a ${msgType} message`);

        logger.setLogLevel('debug');
        logger.exception(`this is a ${msgType} message`, new Error('foo'));
        logger.exception(`this is a ${msgType} message`);
        logger.debugException(`this is a ${msgType} message [debug]`, new Error('foo'));
        logger.debugException(`this is a ${msgType} message [debug]`);

        assert.lengthOf(coreStub.logger.messages.error, 3);
        assert.lengthOf(coreStub.logger.messages.debug, 2);
        assert.include(coreStub.logger.messages.error[1], `this is a ${msgType} message`);
        assert.include(coreStub.logger.messages.error[2], `this is a ${msgType} message\nTraceback:\nno traceback available`);
        assert.include(coreStub.logger.messages.debug[0], `this is a ${msgType} message [debug]`);
        assert.include(coreStub.logger.messages.debug[1], `this is a ${msgType} message [debug]\nTraceback:\nno traceback available`);
    });

    it('should stringify object', () => {
        const msg = {
            foo: 'bar'
        };
        logger.info(msg);
        assert.include(coreStub.logger.messages.info[0], '{"foo":"bar"}');
    });

    it('should get a child logger', () => {
        const prefix = 'prefix';
        const childLogger = logger.getChild(prefix);
        childLogger.info('foo');
        assert.strictEqual(coreStub.logger.messages.info[0], `[telemetry.${prefix}] foo`);
    });

    it('should mask secrets in JSON string', () => {
        const mask = '*********';
        const decl = {
            someSecretData: {
                cipherText: 'test_passphrase_1'
            },
            someSecretData_2: {
                passphrase: 'test_passphrase_2'
            },
            someSecretData_3: {
                nestedData: {
                    passphrase: {
                        cipherText: 'test_passphrase_3'
                    }
                }
            },
            someSecretData_4: {
                nestedData: {
                    passphrase: 'test_passphrase_4'
                }
            },
            jsonData: JSON.stringify({
                someSecretData: {
                    cipherText: 'test_passphrase_1'
                },
                someSecretData_2: {
                    passphrase: 'test_passphrase_2'
                }
            }, null, 1)
        };
        const expected = 'this contains secrets: {'
            + `"someSecretData":{"cipherText":"${mask}"},`
            + `"someSecretData_2":{"passphrase":"${mask}"},`
            + `"someSecretData_3":{"nestedData":{"passphrase":{"cipherText":"${mask}"}}},`
            + `"someSecretData_4":{"nestedData":{"passphrase":"${mask}"}},`
            + '"jsonData":"{\\n \\"someSecretData\\": {\\n  \\"cipherText\\": \\"*********\\"\\n },\\n \\"someSecretData_2\\": {\\n  \\"passphrase\\": \\"*********\\"\\n }\\n}"'
            + '}';
        logger.info(`this contains secrets: ${JSON.stringify(decl)}`);
        assert.include(coreStub.logger.messages.info[0], expected, 'should mask secrets');

        logger.info(coreStub.logger.messages.info[0]);
        assert.include(coreStub.logger.messages.info[1], expected, 'should keep message the same once masked');
    });

    it('should mask secrets in JSON data', () => {
        const mask = '*********';
        const decl = {
            someSecretData: {
                cipherText: 'test_passphrase_1'
            },
            someSecretData_2: {
                passphrase: 'test_passphrase_2'
            },
            someSecretData_3: {
                nestedData: {
                    passphrase: {
                        cipherText: 'test_passphrase_3'
                    }
                }
            },
            someSecretData_4: {
                nestedData: {
                    passphrase: 'test_passphrase_4'
                }
            },
            jsonData: JSON.stringify({
                someSecretData: {
                    cipherText: 'test_passphrase_1'
                },
                someSecretData_2: {
                    passphrase: 'test_passphrase_2'
                }
            }, null, 1)
        };
        const expected = '{'
            + `"someSecretData":{"cipherText":"${mask}"},`
            + `"someSecretData_2":{"passphrase":"${mask}"},`
            + `"someSecretData_3":{"nestedData":{"passphrase":"${mask}"}},`
            + `"someSecretData_4":{"nestedData":{"passphrase":"${mask}"}},`
            + '"jsonData":"{\\n \\"someSecretData\\": {\\n  \\"cipherText\\": \\"*********\\"\\n },\\n \\"someSecretData_2\\": {\\n  \\"passphrase\\": \\"*********\\"\\n }\\n}"'
            + '}';
        logger.info(decl);
        assert.include(coreStub.logger.messages.info[0], expected, 'should mask secrets');
    });

    it('should break circular refs', () => {
        const expected = '{"level1":{"ref":"circularRefFound"}}';
        const root = { level1: {} };
        root.level1.ref = root;

        logger.info(root);

        assert.include(coreStub.logger.messages.info[0], expected, 'should break circular refs');
    });
});
