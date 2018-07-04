const socketCluster = require('socketcluster-client');
const {Disposable} = require('event-kit')
const Errors = require('./errors')

module.exports =
class SocketClusterPubSubGateway {
  constructor ({}) {
    this.socketClusterClient = createDisconnectedSocketClusterClient()
  }

  async subscribe (channelName, eventName, callback) {
    channelName = channelName.replace(/\//g, '.')
    let eventChannel = this.socketClusterClient.subscribe(`${channelName}.${eventName}`);

    eventChannel.watch(callback);

    return new Disposable(() => {
      this.socketClusterClient.unsubscribe(`${channelName}.${eventName}`)
    })
  }
}

function createDisconnectedSocketClusterClient () {
  const options = {
    port: 8000
  };

  const socket = socketCluster.create(options);
  return socket
}
