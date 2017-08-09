require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/real-time-server')
const condition = require('./helpers/condition')
const {buildPeerPool, clearPeerPools} = require('./helpers/peer-pools')
const buildStarNetwork = require('./helpers/build-star-network')
const getExampleMediaStream = require('./helpers/get-example-media-stream')
const Router = require('../lib/router')

suite('Router', () => {
  let server

  suiteSetup(async () => {
    server = await startTestServer()
  })

  suiteTeardown(() => {
    return server.stop()
  })

  setup(() => {
    return server.reset()
  })

  teardown(() => {
    clearPeerPools()
  })

  test('notifications', async () => {
    const hub = buildStarNetwork('some-network-id', await buildPeerPool('hub', server), true)
    const spoke1 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-1', server), false)
    const spoke2 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-2', server), false)
    await spoke1.connectTo('hub')
    await spoke2.connectTo('hub')

    const hubRouter = new Router(hub)
    const spoke1Router = new Router(spoke1)
    const spoke2Router = new Router(spoke2)
    recordNotifications(hubRouter, ['channel-1'])
    recordNotifications(spoke1Router, ['channel-1', 'channel-2'])
    recordNotifications(spoke2Router, ['channel-1', 'channel-2'])

    hubRouter.notify('channel-2', 'from-hub')
    spoke1Router.notify('channel-1', 'from-spoke-1')
    spoke2Router.notify('channel-2', 'from-spoke-2')

    await condition(() => deepEqual(hubRouter.testInbox, {
      'channel-1': [{senderId: 'spoke-1', message: 'from-spoke-1'}]
    }))
    await condition(() => deepEqual(spoke1Router.testInbox, {
      'channel-2': [
        {senderId: 'hub', message: 'from-hub'},
        {senderId: 'spoke-2', message: 'from-spoke-2'}
      ]
    }))
    await condition(() => deepEqual(spoke2Router.testInbox, {
      'channel-1': [{senderId: 'spoke-1', message: 'from-spoke-1'}],
      'channel-2': [{senderId: 'hub', message: 'from-hub'}]
    }))
  })

  test('request/response', async () => {
    const hub = buildStarNetwork('some-network-id', await buildPeerPool('hub', server), true)
    const spoke1 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-1', server), false)
    const spoke2 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-2', server), false)
    await spoke1.connectTo('hub')
    await spoke2.connectTo('hub')

    const spoke1Router = new Router(spoke1)
    const spoke2Router = new Router(spoke2)

    spoke2Router.onRequest('channel-1', ({senderId, requestId, request}) => {
      assert.equal(request.toString(), 'request from spoke 1 on channel 1')
      spoke2Router.respond(requestId, 'response from spoke 2 on channel 1')
    })
    spoke2Router.onRequest('channel-2', ({senderId, requestId, request}) => {
      assert.equal(request.toString(), 'request from spoke 1 on channel 2')
      spoke2Router.respond(requestId, 'response from spoke 2 on channel 2')
    })

    {
      const response = await spoke1Router.request('spoke-2', 'channel-1', 'request from spoke 1 on channel 1')
      assert.equal(response.toString(), 'response from spoke 2 on channel 1')
    }

    {
      const response = await spoke1Router.request('spoke-2', 'channel-2', 'request from spoke 1 on channel 2')
      assert.equal(response.toString(), 'response from spoke 2 on channel 2')
    }

    // Ensure requests and responses with no body are allowed
    {
      spoke2Router.onRequest('channel-3', ({senderId, requestId, request}) => {
        assert.equal(request.length, 0)
        spoke2Router.respond(requestId)
      })
      const response = await spoke1Router.request('spoke-2', 'channel-3')
      assert.equal(response.length, 0)
    }

    // Ensure that multiple responses are disallowed
    {
      spoke2Router.onRequest('channel-4', ({senderId, requestId, request}) => {
        spoke2Router.respond(requestId, 'response from spoke 2 on channel 4')
        assert.throws(
          () => spoke2Router.respond(requestId, 'duplicate response'),
          'Multiple responses to the same request are not allowed'
        )
      })

      await spoke1Router.request('spoke-2', 'channel-4', 'request from spoke 1 on channel 3')
    }
  })

  test('track broadcast', async () => {
    const hubPool = await buildPeerPool('hub', server)
    const hub = buildStarNetwork('some-network-id', hubPool, true)
    const spoke1Pool = await buildPeerPool('spoke-1', server)
    const spoke1 = buildStarNetwork('some-network-id', spoke1Pool, false)
    const spoke2Pool = await buildPeerPool('spoke-2', server)
    const spoke2 = buildStarNetwork('some-network-id', spoke2Pool, false)
    await spoke1.connectTo('hub')
    await spoke2.connectTo('hub')

    const hubRouter = new Router(hub)
    const spoke1Router = new Router(spoke1)
    const spoke2Router = new Router(spoke2)

    recordTracks(hubRouter, ['channel-1'])
    recordTracks(spoke1Router, ['channel-1', 'channel-2'])
    recordTracks(spoke2Router, ['channel-1', 'channel-2'])

    const stream = await getExampleMediaStream()
    const track0 = stream.getTracks()[0]
    const track1 = stream.getTracks()[1]

    hubRouter.broadcastTrack('channel-1', 'metadata-1', track0, stream)
    spoke1Router.broadcastTrack('channel-2', 'metadata-2', track1, stream)

    await condition(() => spoke1Router.testTracks['channel-1'][track0.id])
    await condition(() => spoke2Router.testTracks['channel-1'][track0.id])
    assert.equal(spoke1Router.testTracks['channel-1'][track0.id].senderId, 'hub')
    assert.equal(spoke1Router.testTracks['channel-1'][track0.id].metadata, 'metadata-1')
    assert.equal(spoke2Router.testTracks['channel-1'][track0.id].senderId, 'hub')
    assert.equal(spoke2Router.testTracks['channel-1'][track0.id].metadata, 'metadata-1')
    assert(!hubRouter.testTracks['channel-1'][track0.id])

    await condition(() => spoke2Router.testTracks['channel-2'][track1.id])
    assert.equal(spoke2Router.testTracks['channel-2'][track1.id].senderId, 'spoke-1')
    assert.equal(spoke2Router.testTracks['channel-2'][track1.id].metadata, 'metadata-2')
    assert(!spoke1Router.testTracks['channel-2'][track1.id])
    assert(!hubRouter.testTracks['channel-2'])
  })
})

function recordNotifications (router, channelIds) {
  if (!router.testInbox) router.testInbox = {}
  channelIds.forEach((channelId) => {
    router.onNotification(channelId, ({senderId, message}) => {
      if (!router.testInbox[channelId]) router.testInbox[channelId] = []
      router.testInbox[channelId].push({
        senderId, message: message.toString()
      })
      router.testInbox[channelId].sort((a, b) => a.senderId.localeCompare(b.senderId))
    })
  })
}

function recordTracks (router, channelIds) {
  if (!router.testTracks) router.testTracks = {}
  channelIds.forEach((channelId) => {
    router.testTracks[channelId] = {}
    router.onTrack(channelId, ({senderId, metadata, track}) => {
      router.testTracks[channelId][track.id] = {
        senderId, metadata: metadata.toString(), track
      }
    })
  })
}
