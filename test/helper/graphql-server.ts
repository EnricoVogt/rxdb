/**
 * spawns a graphql-server
 * that can be used in tests and examples
 * @link https://graphql.org/graphql-js/running-an-express-graphql-server/
 */

import graphQlClient from 'graphql-client';
import { PubSub } from 'graphql-subscriptions';
import {
    buildSchema,
    execute,
    subscribe
} from 'graphql';
import { createServer } from 'http';
import { SubscriptionServer } from 'subscriptions-transport-ws';

const express = require('express');
const graphqlHTTP = require('express-graphql');

let lastPort = 16121;

function sortByUpdatedAtAndPrimary(a: any, b: any): 0 | 1 | -1 {
    if (a.updatedAt > b.updatedAt) return 1;
    if (a.updatedAt < b.updatedAt) return -1;

    if (a.updatedAt === b.updatedAt) {
        if (a.id > b.id) return 1;
        if (a.id < b.id) return -1;
        else return 0;
    }
    return 0;
}

export async function spawn(documents: any[] = []) {
    const app = express();
    const port = lastPort++;

    /**
     * schema in graphql
     * matches ./schemas.js#humanWithTimestamp
     */
    const schema = buildSchema(`
        type Query {
            info: Int
            feedForRxDBReplication(lastId: String!, minUpdatedAt: Int!, limit: Int!): [Human!]!
        }
        type Mutation {
            setHuman(human: HumanInput): Human
        }
        input HumanInput {
            id: ID!,
            name: String!,
            age: Int!,
            updatedAt: Int!,
            deleted: Boolean!
        }
        type Human {
            id: ID!,
            name: String!,
            age: Int!,
            updatedAt: Int!,
            deleted: Boolean!
        }
        type Subscription {
            humanChanged: Human
        }

        schema {
            query: Query
            mutation: Mutation
            subscription: Subscription
        }
    `);

    const pubsub = new PubSub();
    /*pubsub.subscribe('humanChanged', data => {
        console.log('pubsub recieved!!');
        console.dir(data);
    });*/

    // The root provides a resolver function for each API endpoint
    const root = {
        info: () => 1,
        feedForRxDBReplication: (args: any) => {
            // console.log('## feedForRxDBReplication');
            // console.dir(args);
            // sorted by updatedAt and primary
            const sortedDocuments = documents.sort(sortByUpdatedAtAndPrimary);

            // only return where updatedAt >= minUpdatedAt
            const filterForMinUpdatedAtAndId = sortedDocuments.filter((doc: any) => {
                if (doc.updatedAt < args.minUpdatedAt) return false;
                if (doc.updatedAt > args.minUpdatedAt) return true;
                if (doc.updatedAt === args.minUpdatedAt) {
                    if (doc.id > args.lastId) return true;
                    else return false;
                }

            });

            // limit
            const limited = filterForMinUpdatedAtAndId.slice(0, args.limit);

            /*
            console.log('sortedDocuments:');
            console.dir(sortedDocuments);
            console.log('filterForMinUpdatedAt:');
            console.dir(filterForMinUpdatedAtAndId);
            console.log('return docs:');
            console.dir(limited);
*/
            return limited;
        },
        setHuman: (args: any) => {
            // console.log('## setHuman()');
            // console.dir(args);
            const doc: any = args.human;
            documents = documents.filter((d: any) => d.id !== doc.id);
            doc.updatedAt = Math.round(new Date().getTime() / 1000);
            documents.push(doc);
            // console.dir(documents);

            pubsub.publish(
                'humanChanged',
                {
                    humanChanged: doc
                }
            );
            return doc;
        },
        humanChanged: () => pubsub.asyncIterator('humanChanged')
    };

    const path = '/graphql';
    app.use(path, graphqlHTTP({
        schema: schema,
        rootValue: root,
        graphiql: true,
    }));

    const ret = 'http://localhost:' + port + path;
    const client = graphQlClient({
        url: ret
    });
    return new Promise(res => {
        const server = app.listen(port, function () {

            const wsPort = port + 500;
            const ws = createServer(server);
            ws.listen(wsPort, () => {
                // console.log(`GraphQL Server is now running on http://localhost:${wsPort}`);
                // Set up the WebSocket for handling GraphQL subscriptions
                const subServer = new SubscriptionServer(
                    {
                        execute,
                        subscribe,
                        schema,
                        rootValue: root
                    }, {
                    server: ws,
                    path: '/subscriptions',
                }
                );

                res({
                    port,
                    wsPort,
                    subServer,
                    client,
                    url: ret,
                    async setDocument(doc: any) {
                        const result = await client.query(
                            `
            mutation CreateHuman($human: HumanInput) {
                setHuman(human: $human) {
                    id,
                    updatedAt
                }
              }

                        `, {
                            human: doc
                        }
                        );
                        // console.dir(result);
                        return result;
                    },
                    overwriteDocuments(docs: any[]) {
                        documents = docs.slice();
                    },
                    getDocuments() {
                        return documents;
                    },
                    close(now = false) {
                        if (now) {
                            server.close();
                            subServer.close();
                        } else {
                            return new Promise(res2 => {
                                setTimeout(() => {
                                    server.close();
                                    subServer.close();
                                    res2();
                                }, 1000);
                            });
                        }
                    }
                });
            });
        });
    });
}
