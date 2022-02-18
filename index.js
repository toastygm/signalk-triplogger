const { Point } = require('where');

module.exports = (app) => {
  const plugin = {};
  let unsubscribes = [];
  const log = {
    trip: 0,
    inTrip: false,
    lastPosition: null,
  };

  plugin.id = 'signalk-triplogger';
  plugin.name = 'Trip logger';
  plugin.description = 'Log the length of the current trip';
  const setStatus = app.setPluginStatus || app.setProviderStatus;

  plugin.start = (options) => {
    const subscription = {
      context: 'vessels.self',
      subscribe: [
        {
          path: 'navigation.state',
          period: 1000,
        },
        {
          path: 'navigation.position',
          period: options.update_interval || 10000,
        },
      ],
    };

    function resetTrip() {
      const resetTime = new Date();
      app.debug(`Reset trip. Was ${log.trip}m`);
      log.trip = 0;
      log.inTrip = true;
      app.handleMessage(plugin.id, {
        context: `vessels.${app.selfId}`,
        updates: [
          {
            source: {
              label: plugin.id,
            },
            timestamp: (new Date().toISOString()),
            values: [
              {
                path: 'navigation.trip.log',
                value: 0,
              },
              {
                path: 'navigation.trip.lastReset',
                value: resetTime,
              },
            ],
          },
        ],
      });
    }

    function appendTrip(distance) {
      app.debug(`Append trip by ${distance}m. Was ${log.trip}m`);
      log.trip += distance;
      app.handleMessage(plugin.id, {
        context: `vessels.${app.selfId}`,
        updates: [
          {
            source: {
              label: plugin.id,
            },
            timestamp: (new Date().toISOString()),
            values: [
              {
                path: 'navigation.trip.log',
                value: log.trip,
              },
            ],
          },
        ],
      });
    }

    app.subscriptionmanager.subscribe(
      subscription,
      unsubscribes,
      (subscriptionError) => {
        app.error(`Error:${subscriptionError}`);
      },
      (delta) => {
        if (!delta.updates) {
          return;
        }
        delta.updates.forEach((u) => {
          if (!u.values) {
            return;
          }
          u.values.forEach((v) => {
            if (v.path === 'navigation.state') {
              // Potential state change
              if (v.value === 'sailing' || v.value === 'motoring') {
                if (!log.inTrip) {
                  // New trip has started
                  resetTrip();
                  setStatus('New trip has started. Log reset');
                }
                // We can ignore switches between sailing and motoring inside trip
              } else {
                // Trip has ended, stop calculating log
                log.inTrip = false;
              }
              return;
            }
            if (v.path === 'navigation.position') {
              const newPosition = new Point(v.value.latitude, v.value.longitude);
              if (log.lastPosition && log.inTrip) {
                const distance = log.lastPosition.distanceTo(newPosition) * 1000;
                appendTrip(distance);
              }
              const tripNm = log.trip / 1852;
              if (log.inTrip) {
                setStatus(`Trip under way, current distance ${tripNm}NM`);
              } else {
                setStatus(`Stopped. Last trip ${tripNm}NM`);
              }
              log.lastPosition = newPosition;
            }
          });
        });
      },
    );

    setStatus('Waiting for updates');
  };

  plugin.stop = () => {
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
  };

  plugin.schema = {
    type: 'object',
    properties: {
      update_interval: {
        type: 'number',
        default: 10000,
        title: 'How often to update log, in milliseconds',
      },
    },
  };

  return plugin;
};
