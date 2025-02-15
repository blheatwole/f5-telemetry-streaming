/*
 * Copyright 2022. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

const actionProcessor = require('./actionProcessor');
const consumersHndlr = require('./consumers');
const logger = require('./logger'); // eslint-disable-line no-unused-vars
const promiseUtil = require('./utils/promise');

/**
* Forward data to consumer
*
* @param {Object} dataCtx      - data context
* @param {Object} dataCtx.data - actual data to forward
* @param {string} dataCtx.type - type of data to forward
*
* @returns {Void} Promise object resolved with undefined
*/
function forwardData(dataCtx) {
    let consumers = consumersHndlr.getConsumers();
    if (!Array.isArray(consumers)) {
        return Promise.resolve();
    }
    consumers = consumers.filter((c) => dataCtx.destinationIds.indexOf(c.id) > -1);
    // don't rely on plugins' code, wrap consumer's call to Promise
    // eslint-disable-next-line
    return promiseUtil.allSettled(consumers.map((consumer) => {
        return new Promise((resolve) => {
            // standard context
            const context = {
                event: consumer.filter.apply(dataCtx),
                config: consumer.config,
                tracer: consumer.tracer,
                logger: logger.getChild(`${consumer.config.type}.${consumer.config.traceName}`),
                metadata: consumer.metadata
            };

            try {
                // Apply actions to the event - event is already deep copied in consumer.filter.apply() call
                actionProcessor.processActions(context.event, consumer.config.actions);
            } catch (err) {
                // Catch the error, but do not exit
                context.logger.exception('Error on attempt to process actions on consumer', err);
            }

            // forwarding not guaranteed to succeed, but we will not throw error if attempt failed
            try {
                consumer.consumer(context);
            } catch (err) {
                context.logger.exception('Error on attempt to forward data to consumer', err);
            } finally {
                resolve();
            }
        });
    }));
}

module.exports = {
    forward: forwardData
};
