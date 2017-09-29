const StarOverlayNetwork = require('../../lib/star-overlay-network')

module.exports =
function buildStarNetwork (id, peerPool, {isHub, connectionTimeout}={}) {
  const network = new StarOverlayNetwork({id, peerPool, isHub, connectionTimeout})

  network.testJoinEvents = []
  network.onMemberJoin(({peerId}) => network.testJoinEvents.push(peerId))

  network.testLeaveEvents = []
  network.onMemberLeave(({peerId, connectionLost}) => network.testLeaveEvents.push({peerId, connectionLost}))

  network.testInbox = []
  network.onReceive(({senderId, message}) => {
    network.testInbox.push({
      senderId,
      message: message.toString()
    })
  })

  return network
}
