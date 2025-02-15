Troubleshooting
===============
Use this section to read about known issues and for common troubleshooting steps.

Telemetry Streaming general troubleshooting tips
------------------------------------------------

- Examine the restnoded failure log at **/var/log/restnoded/restnoded.log** (this is where Telemetry Streaming records error messages).

- Examine the REST response:

  - A 400-level response carries an error message with it
  - If this message is missing, incorrect, or misleading, let us know by filing an |issues|.

- Use Telemetry's trace option to create a detailed trace of the configuration process for subsequent analysis. Telemetry's trace option can be a powerful tool to learn about its working details and to review Telemetry's operations in detail.

Logging
-------
Telemetry Streaming writes log output to the file **/var/log/restnoded/restnoded.log** on the BIG-IP.
The verbosity of the log output can be adjusted by submitting a Telemetry Streaming declaration with a Controls class.
The allowed log levels (in increasing order of verbosity) are **error**, **info**, and **debug**.
The following is an example declaration containing a Controls class that sets the logging level to debug.

.. code-block:: json
   :emphasize-lines: 3-5

    {
        "class": "Telemetry",
        "Controls": {
            "logLevel": "debug"
        },
        "My_System": {
            "class": "Telemetry_System",
            "systemPoller": {
                "interval": 60
            }
        },
        "My_Listener": {
            "class": "Telemetry_Listener",
            "port": 6514
        },
        "My_Consumer": {
            "class": "Telemetry_Consumer",
            "type": "Splunk",
            "host": "192.0.2.1",
            "protocol": "https",
            "port": 8088,
            "passphrase": {
                "cipherText": "apikey"
            }
        }
    }


Tracing
-------
While Telemetry Streaming is processing data, you can configure it to write the current state of the data at key points to files for further inspection.
These files are known as trace files, and can be enabled for the Telemetry_System, Telemetry_System_Poller, Telemetry_Listener, and Telemetry_Consumer classes.
The trace files are written to the BIG-IP file system in the **/var/tmp/telemetry** directory using a filename based on the class and the name it was given.

To enable tracing, set the trace property to **true**. To override the default file output location, set the trace property to a string value containing the new path.

The **Telemetry_Listener** trace setting is a little more complex, see :ref:`trace` for more information.

The most common use for trace files is to determine how far data progresses through the path from the BIG-IP to the third party tool.
**Telemetry_System**, **Telemetry_System_Poller**, and **Telemetry_Listener** trace files are useful for determining if data is making it from the BIG-IP to Telemetry Streaming.
If these trace files are not being generated, or are empty, check the BIG-IP configuration that sets up the sending of data to Telemetry streaming.

**Telemetry_Consumer** trace files are useful for determining if the data is being sent from Telemetry Streaming to the desired third party tool.
If these trace files are not being generated, or are empty, then check your **Telemetry_Consumer** settings in the Telemetry Streaming declaration.
Also, check the logs for any issues sending the data to the third party tool.
If all trace files look correct, then check any settings, queries, and logs in the third party tool.

The following is an example that enables tracing on the Telemetry_System and Telemetry_Consumer classes.

.. code-block:: json

    {
        "class": "Telemetry",
        "My_System": {
            "class": "Telemetry_System",
            "trace": true,
            "systemPoller": {
                "interval": 60
            }
        },
        "My_Consumer": {
            "class": "Telemetry_Consumer",
            "trace": true,
            "type": "Splunk",
            "host": "192.0.2.1",
            "protocol": "https",
            "port": 8088,
            "passphrase": {
                "cipherText": "apikey"
            }
        }
    }


|


Specific troubleshooting entries
--------------------------------

.. _save:

I need to access declarations I previously sent to Telemetry Streaming
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
In Telemetry Streaming 1.27, TS stored up to 30 recent declarations at **/shared/tmp/telemetry/declarationHistory**. 

In Telemetry Streaming 1.28 and later, TS stores up to 30 recent declarations at **/var/log/restnoded/telemetryDeclarationHistory**.  These stored declarations are now accessible by F5's **qkview** utility for use by F5 Technical Support if necessary.  For more information on the qkview utility, see |qkv|.

This includes declarations submitted upon following events:

- TS start
- Declarations submitted to **/shared/telemetry/declare**
- Declarations submitted to **/shared/telemetry/namespace/<namespace>/declare**
  
.. NOTE:: The data contains information about the submitted declaration and the processed declaration (contains expanded references, default values and so on)

|

I'm receiving a path not registered error when I try to post a declaration
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  

If you are receiving this error, it means either you did not install Telemetry Streaming, or it did not install properly. The error contains the following message:  

.. code-block:: shell

   {
       "code":404,
       "message": "Public URI path no registered. Please see /var/log/restjavad.0.log and /var/log/restnoded/restnoded.log for details.".
       ...
    }


If you receive this error, see :doc:`installation` to install or re-install Telemetry Streaming.

|

.. _elkerror:

I'm receiving a limit of total fields exceeded error when Telemetry Streaming forwards statistics to ElasticSearch
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

If you are receiving this error, it means that Telemetry Streaming is exceeding the maximum allowed number of fields in the ElasticSearch index to which it is forwarding. The error contains the following message: |br|

.. code-block:: bash

    Tue, 04 Jun 2019 22:22:37 GMT - severe: [telemetry.ElasticSearch] error: [illegal_argument_exception] Limit of total fields [1000] in index [f5telemetry] has been exceeded


If you receive this error, use **one** of the following methods to correct the issue:


- Increase the ``index.mapping.total_fields.limit`` setting of the failing index to a larger value to compensate for the amount of data that Telemetry Streaming is sending. This can be accomplished using a **PUT** request to the URI **http(s)://<ElasticSearch>/<index_name>/_settings** with the following JSON body: |br| |br|

   .. code-block:: json

        {
            "index.mapping.total_fields.limit": 2000
        }


- Create the ElasticSearch index with an increased ``index.mapping.total_fields.limit`` value before Telemetry Streaming begins sending data to it. This can be done using a **PUT** request to the URI **http(s)://<ElasticSearch>/<index_name>** with the following JSON body: |br| |br|

   .. code-block:: json

        {
            "settings": {
                "index.mapping.total_fields.limit": 2000
            }
        }

|

.. NOTE:: To see more information about mapping in ElasticSearch, see |ElasticSearch Mapping|.


.. _certerror:

I'm receiving a SELF_SIGNED_CERT_IN_CHAIN error
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

If you are receiving this error, you are using a self-signed certificate in a declaration.  You can use the **allowSelfSignedCert** parameter set to **true** to use self-signed certificates (see :doc:`advanced-options` for more information and usage).  

|

.. _nodist:

I can no longer find the TS source RPM on GitHub
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Beginning with TS 1.7.0, the RPM and checksum files are no longer located in the **/dist** directory in the Telemetry Streaming repository on GitHub.  These files can be found on the |release|, as **Assets**. 

You can find historical files on GitHub by using the **Branch** drop-down, clicking the **Tags** tab, and then selecting the appropriate release.

|

.. _nodata:

Why is data not showing up in my consumer?
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
If data is not appearing in your consumer, use the following troubleshooting advice appropriate for your Telemetry Streaming configuration.

**If you are using the Event Listener** |br|

If you are using the :ref:`Event Listener<eventlistener-ref>` to publish events and/or logs to a Consumer, first check the configuration required for the Event Listener to function successfully. There are three individual configuration tasks that need to occur:

#. Ensure the Telemetry Streaming declaration has a **Telemetry_Listener** class defined, and that when you submit the declaration, it succeeds.
#. Ensure you have completed the base configuration of the BIG-IP, which enables logs and/or events to be published to Telemetry Streaming. See :ref:`logsrc-ref`. |br|    

   .. IMPORTANT:: The BIG-IP documentation references a port number used as a part of publishing logs. The port number you use in this configuration must be the same as the port number in the **port** property of the Telemetry_Listener class in your Telemetry Streaming declaration. The BIG-IP publishes events and/or logs to the IP:PORT defined in the configuration, and Telemetry Streaming listens for events on this port.

#.	Ensure the profiles (AFM/ASM Security Log profiles, or the LTM Request profiles) are attached to the Virtual Servers that should be monitored. Only Virtual Servers that have logging profiles attached publish logs to Telemetry Streaming. See :ref:`loggingprofiles`.
 
|

**If you are attempting to use the System Poller** |br|

If you are using the System Poller to get metrics from your BIG-IP, ensure that your Telemetry Streaming declaration has a :ref:`Telemetry_System class<tssystem-ref>`, and this class has the **systemPoller** property defined.

|

**Verify the Consumer configuration** |br|

Once you have verified your Event Listener and/or System Poller, check the configuration for the Consumer(s) in your declaration, and ensure that any external consumers are reachable from the BIG-IP device.  See :doc:`setting-up-consumer` and :doc:`pull-consumers` for consumer configuration.

|

**Check the Telemetry Streaming logs** |br|

By default, Telemetry Streaming logs to **restnoded.log** (stored on the BIG-IP at **/var/log/restnoded/restnoded.log**), at the *info* level. At the *info* log level, you can see any errors that Telemetry Streaming encounters. The consumers within Telemetry Streaming also log an error if they are not able to connect to the external system.

For example, the following log line shows that the Fluent_Consumer cannot connect to the external system at 10.10.1.1:343:

``Wed, 01 Jul 2020 21:36:13 GMT - severe: [telemetry.Generic_HTTP.Fluent_Consumer] error: connect ECONNREFUSED 10.10.1.1:343``
 
|

Additionally, you can adjust the log level of Telemetry Streaming by changing the **logLevel** property in the **Controls** object (see |controls| in the schema reference). 

When the log level is set to **debug**, many more events are logged to the restnoded log. For example, you can see:

- When the System Poller successfully runs, and if the Consumer(s) were able to successfully publish the System Poller data. The following example log shows the System Poller data (data type: systemInfo) was successfully processed, and where the Fluent_Consumer successfully published that data:
  
  .. code-block:: bash

     Wed, 01 Jul 2020 21:46:59 GMT - finest: [telemetry] Pipeline processed data of type: systemInfo 
     Wed, 01 Jul 2020 21:46:59 GMT - finest: [telemetry] System poller cycle finished
     Wed, 01 Jul 2020 21:46:59 GMT - finest: [telemetry.Generic_HTTP.Fluent_Consumer] success

- When the Event Listener publishes events, the type of that event, and whether the Consumer successfully published the event. The following example shows both an ASM and LTM event being successfully processed by Telemetry Streaming, and published by the Fluent_Consumer:  

  .. code-block:: bash

     Wed, 01 Jul 2020 21:48:59 GMT - finest: [telemetry] Pipeline processed data of type: ASM 
     Wed, 01 Jul 2020 21:48:59 GMT - finest: [telemetry] Pipeline processed data of type: LTM
     Wed, 01 Jul 2020 21:48:59 GMT - finest: [telemetry.Generic_HTTP.Fluent_Consumer] success
     Wed, 01 Jul 2020 21:48:59 GMT - finest: [telemetry.Generic_HTTP.Fluent_Consumer] success


|

.. _eventlistenerdata:

How can I check if my Telemetry Streaming Event Listener is sending data to my consumer?
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
Telemetry Streaming v1.19 introduced a new feature that allows you to send arbitrary data to a Telemetry Streaming Event Listener instead of waiting for the BIG-IP to send a message(s) to the Event Listener.  This allows you to test that your Telemetry Streaming Consumers are properly configured.

You must have already submitted a declaration that includes the following:
    - An Event Listener
    - In the |controls| class, the **debug** property set to **true**.
    - You should have a Consumer in your declaration so you can see the test payload successfully made it to your Consumer.


To check that your Event Listener is sending data to the Consumer, you send an HTTP POST to one of the two new endpoints introduced in v1.19, depending on whether you are using |namespaceref| or not:

- If not using Namespaces: ``https://{{host}}/mgmt/shared/telemetry/eventListener/{{listener_name}}``

- If using Namespaces: ``https://{{host}}/mgmt/shared/telemetry/namespace/{{namespace_name}}/eventListener/{{listener_name}}``


You can send any valid (but also arbitrary) JSON body, such as:

.. code-block:: json

    {
        "message": "my debugging message"
    }


Telemetry Streaming sends this JSON payload to the Event Listener you specified, and the Event Listener processes and sends this debugging payload through Telemetry Streaming to any/all of the your configured Consumers.

|


.. _trace:

How can I write an Event Listener's incoming raw data to a trace file?
----------------------------------------------------------------------
.. sidebar:: :fonticon:`fa fa-info-circle fa-lg` Version Notice:

   Support for writing an Event Listener's incoming raw data to a trace file is available in TS v1.20 and later

In Telemetry Streaming 1.20 and later you can configure TS to write an Event Listener's incoming raw data to a trace file. This is useful when troubleshooting, as it allows you to reproduce the exact issue instead of relying on the BIG-IP configuration, profiles, and traffic generation.

This feature is enabled using the **trace** property with values of **input** and/or **output**. All data is written to the ``/var/tmp/telemetry`` directory (or check logs for the exact file path).

.. IMPORTANT:: **Input** tracing data is written in HEX format. If you want to remove sensitive data, you need to decode HEX data, clean or remove the sensitive data, and re-encode it back to HEX format. But this operation does not guarantee 100% reproduction of issue (in the case of input tracing data will be sent to F5 Support for further investigation). Instead of cleaning the data (or complete removal of sensitive data), we recommend replacing it with non-sensitive data (i.e. the exact same size and original encoding).

The following is an example of configuring the Event Listener to trace incoming data:

.. code-block:: json

    {
        "class": "Telemetry",
        "Listener": {
            "class": "Telemetry_Listener",
            "trace": {
                "type": "input"
            }
        }
    }

|

If you want to enable both input and output tracing, use the following syntax in your Event Listener:

.. code-block:: json

    {
        "class": "Telemetry",
        "Listener": {
            "class": "Telemetry_Listener",
            "trace": [
                {
                    "type": "input"
                },
                {
                    "type": "output"
                }
            ]
        }
    }

|

.. _restjavad:

Why is my BIG-IP experiencing occasional high CPU usage and slower performance?
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
If your BIG-IP system seems to be using a relatively high amount of CPU and degraded performance, you may be experiencing a known issue with the **restjavad** daemon. This is an issue with the underlying BIG-IP framework, and not an issue with Telemetry Streaming.

**More information** |br|
Restjavad may become unstable if the amount of memory required by the daemon exceeds the value allocated for its use. The memory required by the restjavad daemon may grow significantly in system configurations with either a high volume of device statistics collection (AVR provisioning), or a with relatively large number of LTM objects managed by the REST framework (SSL Orchestrator provisioning). The overall system performance is degraded during the continuous restart of the restjavad daemon due to high CPU usage. 

See `Bug ID 894593 <https://cdn.f5.com/product/bugtracker/ID894593.html>`_, `Bug ID 776393 <https://cdn.f5.com/product/bugtracker/ID776393.html>`_, and `Bug ID 839597 <https://cdn.f5.com/product/bugtracker/ID839597.html>`_.

**Workaround** |br|
Increase the memory allocated for the restjavad daemon (e.g. 2 GB), by running the following commands in a BIG-IP terminal.
 
``tmsh modify sys db restjavad.useextramb value true`` |br|
``tmsh modify sys db provision.extramb value 2048`` |br|
``bigstart restart restjavad``

.. IMPORTANT:: You should not exceed 2500MB

|

.. _memory: 

Where can I find Telemetry Streaming memory threshold information?
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
This section contains guidance how to configure the Telemetry Streaming memory usage threshold to help prevent **restnoded** from restarting when too much memory is used. When **restnoded** restarts, the Telemetry Streaming consumer is unavailable.

Telemetry Streaming v1.18 introduced a change in behavior by adding monitor checks that run by default. Memory usage is monitored to prevent **restnoded** from crashing and restarting if memory usage becomes too high. By default (without user configuration), this translates to 90% of total memory allocated for restnoded (1433 MB by default, unless you set the db variables as noted in the workaround section of :ref:`restjavad`).

You can configure your memory threshold using the new **memoryThresholdPercent** property in the **Controls** class.  For example, to set the memory threshold to 65%, you use:

.. code-block:: json
   :emphasize-lines: 6

   {
    "class": "Telemetry",
    "controls": {
        "class": "Controls",
        "logLevel": "info",
        "memoryThresholdPercent": 65
        }
    }

.. NOTE:: You can disable monitor checks by setting **memoryThresholdPercent** value to 100.


Monitor checks run by default on intervals depending on %memory usage:

.. list-table::
      :header-rows: 1

      * - % of total memory usage
        - Interval
      
      * - 0 - 24
        - 30 seconds 
  
      * - 25 - 49
        - 15 seconds 
  
      * - 50 - 74
        - 10 seconds 

      * - 75 - 89
        - 5 seconds 

      * - 90+
        - 3 seconds 


|

.. _splunkmem:

Why do I see memory usage spikes when TS is configured to send data to a Splunk consumer?
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
By default, Telemetry Streaming compresses data before sending it to Splunk. Depending on the events per second rate (events from the Event Listener and System Poller), you may see spikes in memory usage. 

Telemetry Streaming 1.19 and later includes the **compressionType** property in the |telemetryconsumer| class.  You can set this property to **none** (**gzip** is the default) to help reduce memory usage.



.. |br| raw:: html

   <br />

.. |ElasticSearch Mapping| raw:: html

   <a href="https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html" target="_blank">ElasticSearch mapping documentation</a>

.. |release| raw:: html

   <a href="https://github.com/F5Networks/f5-telemetry-streaming/releases" target="_blank">GitHub Release</a>


.. |controls| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-telemetry-streaming/latest/schema-reference.html#controls" target="_blank">Controls</a>

.. |namespaceref| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-telemetry-streaming/latest/namespaces.html" target="_blank">Namespaces</a>

.. |telemetryconsumer| raw:: html
 
   <a href="https://clouddocs.f5.com/products/extensions/f5-telemetry-streaming/latest/schema-reference.html#telemetry-consumer" target="_blank">Telemetry_Consumer</a>


.. |issues| raw:: html

   <a href="https://github.com/F5Networks/f5-telemetry-streaming/issues" target="_blank">Issue on GitHub</a>

.. |qkv| raw:: html

   <a href="https://github.com/F5Networks/f5-telemetry-streaming/issues" target="_blank">qkview on AskF5</a>