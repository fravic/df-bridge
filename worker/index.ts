import * as redis from "redis";
import fetch from "isomorphic-fetch";
import {
  split,
  HttpLink,
  ApolloClient,
  InMemoryCache,
  gql,
} from "@apollo/client/core";
import { getMainDefinition } from "@apollo/client/utilities";
import { WebSocketLink } from "@apollo/client/link/ws";
import WebSocket from "ws";

import {
  LAST_BLOCK_PROCESSED_KEY,
  SUBSCRIBED_ETH_ADDRS_KEY,
} from "../common/constants";

type RedisClient = ReturnType<typeof redis.createClient>;

const GRAPH_URL_HTTP =
  process.env.GRAPH_URL_HTTP ||
  "https://api.thegraph.com/subgraphs/name/darkforest-eth/dark-forest-v06-round-4";

const GRAPH_URL_WS =
  process.env.GRAPH_URL_WS ||
  "ws://api.thegraph.com/subgraphs/name/darkforest-eth/dark-forest-v06-round-4";

const httpLink = new HttpLink({
  uri: GRAPH_URL_HTTP,
  fetch,
});

const wsLink = new WebSocketLink({
  uri: GRAPH_URL_WS,
  options: {
    reconnect: true,
  },
  webSocketImpl: WebSocket,
});

// The split function takes three parameters:
//
// * A function that's called for each operation to execute
// * The Link to use for an operation if the function returns a "truthy" value
// * The Link to use for an operation if the function returns a "falsy" value
const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === "OperationDefinition" &&
      definition.operation === "subscription"
    );
  },
  wsLink,
  httpLink
);

const ARRIVALS_SUBSCRIPTION = gql`
  subscription {
    arrivals(orderBy: departureTime, orderDirection: desc, first: 100) {
      player {
        id
      }
      toPlanet {
        owner {
          id
        }
      }
      milliEnergyArriving
      arrivalTime
      departureTime
    }
  }
`;

(async function main() {
  const redisClient = redis.createClient<any>({ url: process.env.REDIS_URL });
  redisClient.on("error", (err: any) => console.log("Redis Client Error", err));
  await redisClient.connect();
  let timeoutId;

  const client = new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
  });

  const observable = client.subscribe({
    query: ARRIVALS_SUBSCRIPTION,
  });
  observable.subscribe((data) => {
    console.log(
      "Subscription received arrivals data with count events:",
      data.data?.arrivals.length
    );
  });
})();
