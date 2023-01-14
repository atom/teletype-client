##### Atom and all repositories under Atom will be archived on December 15, 2022. Learn more in our [official announcement](https://github.blog/2022-06-08-sunsetting-atom/)
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

3. Create postgresql docker instance:

    ```
    docker-compose up -d
    cp .env.local.example .env
    ```

## TODO

* [ ] Document APIs
