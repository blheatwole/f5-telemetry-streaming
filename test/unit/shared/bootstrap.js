/*
 * Copyright 2022. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

const values = require('object.values');
require('./restoreCache');

if (!Object.values) {
    values.shim();
}

/* eslint-disable no-console */

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
    throw reason;
});

// because we're restoring cache
// it instantiates monitor that's supposed to be singleton
// so set these to work around tests
process.setMaxListeners(15);
// tests needing the monitor should manually enable these
// constants.APP_THRESHOLDS.MONITOR_DISABLED
process.env.MONITOR_DISABLED = true;
