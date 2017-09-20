class ClientOutOfDateError extends Error {
  constructor () {
    super(...arguments)
  }
}

class NetworkConnectionError extends Error {
  constructor () {
    super(...arguments)
  }
}

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

class PortalJoinError extends Error {
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
  ClientOutOfDateError,
  NetworkConnectionError,
  PeerConnectionError,
  PortalCreationError,
  PortalJoinError,
  PortalNotFoundError,
  PubSubConnectionError
}
