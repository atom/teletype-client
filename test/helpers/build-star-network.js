const StarOverlayNetwork = require('../../lib/star-overlay-network')

module.exports =
function buildStarNetwork (id, peerPool, isHub) {
  const network = new StarOverlayNetwork({id, peerPool, isHub})

  network.testJoinEvents = []
  network.onJoin(({peerId}) => network.testJoinEvents.push(peerId))

  network.testInbox = []
  network.onReceive(({senderId, message}) => {
    network.testInbox.push({
      senderId,
      message: message.toString()
    })
  })
  return network
}
