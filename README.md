# teletype-client

The editor-agnostic library managing the interaction with other clients to support peer-to-peer collaborative editing in [Teletype for Atom](https://github.com/atom/teletype).

## Hacking

### Dependencies

To run teletype-client tests locally, you'll first need to have:

- Node 7+
- PostgreSQL 9.x

### Running locally

1. Clone and bootstrap

    ```
    git clone https://github.com/atom/teletype-client.git
    cd teletype-client
    cp .env.example .env
    createdb teletype-server-test
    npm install
    ```

2. Run the tests

    ```
    npm test
    ```

## TODO

* [ ] Document APIs
