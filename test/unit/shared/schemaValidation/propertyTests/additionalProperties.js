/*
 * Copyright 2022. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const lodash = require('lodash');

const utils = require('../utils');

chai.use(chaiAsPromised);
const assert = chai.assert;

module.exports = {
    /**
     * @returns {string} name to use to configure tests
     */
    name() {
        return 'additionalPropsTests';
    },

    /**
     * Generate tests for 'additionalProperties' keyword
     *
     * @param {PropertyTestCtx} ctx - context
     * @param {AdditionalPropsTestConf} testConf - test config
     *
     * @returns {void} once tests were generated
     */
    tests(ctx, testConf) {
        const subTitle = utils.testControls.fmtSubTitle(testConf);
        utils.testControls.getSubTestDescribe(testConf)(`"additionalProperties" keyword tests${subTitle}`, () => {
            if (testConf.allowed) {
                const combinations = utils.arrayCombinations(
                    Object.keys(testConf.allowed),
                    testConf.combinations ? 1 : Object.keys(testConf.allowed).length,
                    Object.keys(testConf.allowed).length
                );
                combinations.forEach((propSets) => {
                    it(`should allow additional properties - ${propSets.join(', ')}`, () => {
                        const testDecl = lodash.cloneDeep(ctx.declaration);
                        lodash.set(
                            testDecl,
                            ctx.property,
                            Object.assign(
                                lodash.get(testDecl, ctx.property),
                                lodash.pick(testConf.allowed, propSets)
                            )
                        );
                        return assert.isFulfilled(
                            ctx.validator(testDecl),
                            `property "${ctx.propFullName}" should allow additional properties`
                        );
                    });
                });
            }
            if (testConf.notAllowed) {
                const combinations = utils.arrayCombinations(
                    Object.keys(testConf.notAllowed),
                    testConf.combinations ? 1 : Object.keys(testConf.notAllowed).length,
                    Object.keys(testConf.notAllowed).length
                );
                combinations.forEach((propSets) => {
                    it(`should not allow additional properties - ${propSets.join(', ')}`, () => {
                        const testDecl = lodash.cloneDeep(ctx.declaration);
                        lodash.set(
                            testDecl,
                            ctx.property,
                            Object.assign(
                                lodash.get(testDecl, ctx.property),
                                lodash.pick(testConf.notAllowed, propSets)
                            )
                        );
                        return assert.isRejected(
                            ctx.validator(testDecl),
                            /"keyword":"additionalProperties"/, // check for keyword only (multiple props not allowed)
                            `property "${ctx.propFullName}" should not allow additional properties`
                        );
                    });
                });
            }
        });
        if (testConf.failing) {
            const combinations = utils.arrayCombinations(
                Object.keys(testConf.failing),
                testConf.combinations ? 1 : Object.keys(testConf.failing).length,
                Object.keys(testConf.failing).length
            );
            combinations.forEach((propSets) => {
                it(`should fail on attempt to set additional properties - ${propSets.join(', ')}${subTitle}`, () => {
                    const testDecl = lodash.cloneDeep(ctx.declaration);
                    lodash.set(
                        testDecl,
                        ctx.property,
                        Object.assign(
                            lodash.get(testDecl, ctx.property),
                            lodash.pick(testConf.failing, propSets)
                        )
                    );
                    return assert.isRejected(
                        ctx.validator(testDecl),
                        /keyword/,
                        `should fail property "${ctx.propFullName}" validation when set invalid additional properties`
                    );
                });
            });
        }
    },

    /**
     * Process and normalize test options
     *
     * @param {AdditionalPropsTestConf} options
     *
     * @returns {AdditionalPropsTestConf} processed and normalized options
     */
    options(options) {
        const processOpts = (opts) => {
            if (opts === true) {
                return { [utils.randomString(10)]: utils.randomString(10) };
            }
            if (lodash.isString(opts)) {
                return { [opts]: utils.randomString(10) };
            }
            if (lodash.isArray(opts)) {
                const ret = {};
                opts.forEach((pName) => {
                    assert.isString(pName, 'should be string when specifying property for additionalProperties tests');
                    ret[pName] = utils.randomString(10);
                });
                return ret;
            }
            if (lodash.isUndefined(opts) || lodash.isObject(opts)) {
                return opts;
            }
            return assert.fail(`additionalPropsTests expected to be boolean, string, array of string or object, got "${typeof opts}" instead`);
        };
        if (!lodash.isUndefined(options)) {
            if (lodash.isArray(options) || !lodash.isObject(options)) {
                options.allowed = processOpts(options);
            }
            if (lodash.has(options, 'allowed')) {
                options.allowed = processOpts(options.allowed);
            }
            if (lodash.has(options, 'failing')) {
                options.failing = processOpts(options.failing);
            }
            if (lodash.has(options, 'notAllowed')) {
                options.notAllowed = processOpts(options.notAllowed);
            }
        }
        return options;
    }
};

/**
 * @typedef AdditionalPropsTestConf
 * @type {BaseTestConf}
 * @property {object} allowed - allowed additional property(s)
 * @property {object} notAllowed - not allowed additional property(s)
 *
 * Config to test 'additionalProperties' keyword
 */
