class PeerConnectionError extends Error {
  constructor () {
    super(...arguments)
  }
}

class PortalCreationError extends Error {
  constructor () {
    super(...arguments)
  }
}

class PortalNotFoundError extends Error {
  constructor () {
    super(...arguments)
  }
}

class PubSubConnectionError extends Error {
  constructor () {
    super(...arguments)
  }
}

module.exports = {
  PeerConnectionError,
  PortalCreationError,
  PortalNotFoundError,
  PubSubConnectionError
}
