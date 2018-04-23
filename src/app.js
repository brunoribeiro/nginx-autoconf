const Docker = require("dockerode");
const JSONStream = require("JSONStream");
const util = require("util");
const fs = require("fs");
const path = require("path");
const _ = require("lodash");

const updateConfig = require("./configUpdater").updateConfig;
const nginx = require("./nginx");

const docker = new Docker();

async function handleEvent(event) {
  // filter containers containing `app.virtual_host` label
  const containers = await docker.listContainers({"filters": "{\"label\": [\"app.virtual_host\"]}" });
  const virtualHosts = containers.map(container => {
    // find first networkName
    let networkName;
    for(networkName in container.NetworkSettings.Networks) break;

    return { virtualHost: container.Labels['app.virtual_host'],
             virtualPort: container.Labels['app.virtual_port'],
             ip: container.NetworkSettings.Networks[networkName].IPAddress };
  });

  // create config object as: `{ servername: 'foo.test', ips: [192.168.99.100] }`
  const data = _.chain(virtualHosts)
                .groupBy('virtualHost')
                .toPairs()
                .map(item => {
                  i = _.clone(item);
                  i[0] = item[0];
                  i[1] = item[1][0].virtualPort;
                  i[2] = item[1].map(currentItem => currentItem.ip);
                  return _.zipObject(['serverName', 'port', 'ips'], i);
                })
                .value();

  handleContainersChanges(data);
  await nginx.reload(docker);
}

async function sendEventStream() {
  const eventStream = await docker.getEvents();
  eventStream
    .pipe(JSONStream.parse())
    .on("data", event => handleEvent(event))
    .on("error", e => console.log(`Error: ${util.inspect(e)}`));
}

async function main() {
  await sendEventStream();
}

function handleContainersChanges(config) {
  config.map(conf => updateConfig(conf));
}

main();
