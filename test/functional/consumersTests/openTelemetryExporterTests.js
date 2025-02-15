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
const pathUtil = require('path');

const constants = require('../shared/constants');
const harnessUtils = require('../shared/harness');
const logger = require('../shared/utils/logger').getChild('otelTests');
const miscUtils = require('../shared/utils/misc');
const promiseUtils = require('../shared/utils/promise');
const srcMiscUtils = require('../../../src/lib/utils/misc');
const testUtils = require('../shared/testUtils');

chai.use(chaiAsPromised);
const assert = chai.assert;

/**
 * @module test/functional/consumersTests/openTelemetryExporter
 */

// module requirements
const MODULE_REQUIREMENTS = { DOCKER: true };

const OTEL_METRICS_PATH = '/v1/metrics';
const OTEL_COLLECTOR_FOLDER = 'otel';
const OTEL_COLLECTOR_CONF_FILE = 'config.yaml';
const OTEL_COLLECTOR_RECEIVER_PORT = 55681;
const OTEL_COLLECTOR_PROMETHEUS_PORT = 9088;
const OTEL_COLLECTOR_CONSUMER_NAME = 'OpenTelemetry_Consumer';
const OTEL_COLLECTOR_CONF = `receivers:
  otlp:
    protocols:
      http:

processors:
  batch:

exporters:
  prometheus:
    endpoint: "0.0.0.0:${OTEL_COLLECTOR_PROMETHEUS_PORT}"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]`;

const DOCKER_CONTAINERS = {
    OTELCollector: {
        detach: true,
        image: `${constants.ARTIFACTORY_DOCKER_HUB_PREFIX}otel/opentelemetry-collector-contrib`,
        name: 'otel-collector',
        publish: {
            [OTEL_COLLECTOR_PROMETHEUS_PORT]: OTEL_COLLECTOR_PROMETHEUS_PORT,
            [OTEL_COLLECTOR_RECEIVER_PORT]: OTEL_COLLECTOR_RECEIVER_PORT
        },
        restart: 'always',
        volume: {
            [`$(pwd)/${OTEL_COLLECTOR_FOLDER}/${OTEL_COLLECTOR_CONF_FILE}`]: '/etc/otel/config.yaml'
        }
    }
};

// read in example config
const DECLARATION = miscUtils.readJsonFile(constants.DECL.BASIC);
const LISTENER_PROTOCOLS = constants.TELEMETRY.LISTENER.PROTOCOLS;

let CONTAINER_STARTED;
let SHOULD_SKIP_DUE_VERSION;

/**
 * Setup CS and DUTs
 */
function setup() {
    describe('Consumer Setup: OpenTelemetry Exporter', () => {
        const harness = harnessUtils.getDefaultHarness();
        const cs = harnessUtils.getDefaultHarness().other[0];
        cs.http.createAndSave('otel', {
            port: OTEL_COLLECTOR_PROMETHEUS_PORT,
            protocol: 'http',
            retry: {
                maxTries: 10,
                delay: 1000
            }
        });

        describe('Docker container setup', () => {
            before(() => {
                CONTAINER_STARTED = false;
                SHOULD_SKIP_DUE_VERSION = {};
            });

            it('should pull OTEL docker image', () => cs.docker.pull(DOCKER_CONTAINERS.OTELCollector.image));

            it('should remove pre-existing OTEL docker container', () => harnessUtils.docker.stopAndRemoveContainer(
                cs.docker,
                DOCKER_CONTAINERS.OTELCollector.name
            ));

            it('should write OTEL configuration', () => cs.ssh.default.mkdirIfNotExists(OTEL_COLLECTOR_FOLDER)
                .then(() => cs.ssh.default.writeToFile(
                    pathUtil.join(OTEL_COLLECTOR_FOLDER, OTEL_COLLECTOR_CONF_FILE),
                    OTEL_COLLECTOR_CONF
                )));

            it('should start new OTEL docker container', () => harnessUtils.docker.startNewContainer(
                cs.docker,
                DOCKER_CONTAINERS.OTELCollector
            )
                .then(() => {
                    CONTAINER_STARTED = true;
                }));
        });

        describe('Gather information about DUTs version', () => {
            harness.bigip.forEach((bigip) => it(
                `should get bigip version and check if version is high enough for OpenTelemetry Exporter - ${bigip.name}`,
                () => bigip.icAPI.default.getSoftwareVersion()
                    .then((version) => {
                        // OpenTelemetry Exporter consumer is supported on bigip 14.1 and above
                        SHOULD_SKIP_DUE_VERSION[bigip.hostname] = srcMiscUtils.compareVersionStrings(version, '<', '14.1');

                        logger.info('DUT\' version', {
                            hostname: bigip.hostname,
                            shouldSkipTests: SHOULD_SKIP_DUE_VERSION[bigip.hostname],
                            version
                        });
                    })
            ));
        });
    });
}

/**
 * Tests for DUTs
 */
function test() {
    describe('Consumer Test: OpenTelemetry Exporter', () => {
        const harness = harnessUtils.getDefaultHarness();
        const cs = harness.other[0];
        const testDataTimestamp = Date.now();

        /**
         * @returns {boolean} true if DUt satisfies version restriction
         */
        const isValidDut = (dut) => !SHOULD_SKIP_DUE_VERSION[dut.hostname];

        before(() => {
            assert.isOk(CONTAINER_STARTED, 'should start OTEL container!');
        });

        describe('Configure TS and generate data', () => {
            let consumerDeclaration;

            before(() => {
                consumerDeclaration = miscUtils.deepCopy(DECLARATION);
                consumerDeclaration[OTEL_COLLECTOR_CONSUMER_NAME] = {
                    class: 'Telemetry_Consumer',
                    type: 'OpenTelemetry_Exporter',
                    host: cs.host.host,
                    port: OTEL_COLLECTOR_RECEIVER_PORT,
                    metricsPath: `${OTEL_METRICS_PATH}`
                };
            });

            testUtils.shouldConfigureTS(harness.bigip, (bigip) => (isValidDut(bigip)
                ? miscUtils.deepCopy(consumerDeclaration)
                : null));

            testUtils.shouldSendListenerEvents(harness.bigip, (bigip, proto, port, idx) => (isValidDut(bigip)
                ? `functionalTestMetric="147",EOCTimestamp="1231232",hostname="${bigip.hostname}",testDataTimestamp="${testDataTimestamp}",test="true",testType="${OTEL_COLLECTOR_CONSUMER_NAME}",protocol="${proto}",msgID="${idx}"`
                : null));
        });

        describe('Event Listener data', () => {
            harness.bigip.forEach((bigip) => LISTENER_PROTOCOLS
                .forEach((proto) => it(
                    `should check OTEL for event listener data (over ${proto}) for - ${bigip.name}`,
                    function () {
                        if (!isValidDut(bigip)) {
                            return this.skip();
                        }
                        return cs.http.otel.makeRequest({
                            uri: '/metrics'
                        })
                            .then((data) => {
                                const mockAVRMetricRegex = new RegExp(`functionalTestMetric{.*hostname="${bigip.hostname}".*} 147`);
                                assert.isOk(
                                    data.split('\n')
                                        .some((line) => mockAVRMetricRegex.test(line) && line.indexOf(`protocol="${proto}"`) !== -1),
                                    `should have metrics(s) for a data from event listener (over ${proto})`
                                );
                            })
                            .catch((err) => {
                                bigip.logger.info('No event listener data found. Going to wait another 20sec');
                                return promiseUtils.sleepAndReject(20000, err);
                            });
                    }
                )));
        });

        describe('System Poller data', () => {
            harness.bigip.forEach((bigip) => it(
                `should check OTEL for system poller data - ${bigip.name}`,
                function () {
                    if (!isValidDut(bigip)) {
                        return this.skip();
                    }
                    return cs.http.otel.makeRequest({
                        uri: '/metrics'
                    })
                        .then((data) => {
                            const dutSystemMemoryRegex = new RegExp(`system_memory{.*hostname="${bigip.hostname}".*} \\d{1,2}`);
                            assert.isOk(
                                data.split('\n')
                                    .some((line) => dutSystemMemoryRegex.test(line)),
                                'should have metric(s) for a data from system poller'
                            );
                        })
                        .catch((err) => {
                            bigip.logger.info('No system poller data found. Going to wait another 20sec');
                            return promiseUtils.sleepAndReject(20000, err);
                        });
                }
            ));
        });
    });
}

/**
 * Teardown CS
 */
function teardown() {
    describe('Consumer Teardown: OpenTelemetry Exporter', () => {
        const cs = harnessUtils.getDefaultHarness().other[0];

        it('should stop and remove OTEL docker container', () => harnessUtils.docker.stopAndRemoveContainer(
            cs.docker,
            DOCKER_CONTAINERS.OTELCollector.name
        ));

        it('should remove OTEL configuration file', () => cs.ssh.default.unlinkIfExists(pathUtil.join(OTEL_COLLECTOR_FOLDER, OTEL_COLLECTOR_CONF_FILE)));

        it('should remove OTEL directory', () => cs.ssh.default.rmdirIfExists(OTEL_COLLECTOR_FOLDER));
    });
}

module.exports = {
    MODULE_REQUIREMENTS,
    setup,
    test,
    teardown
};
