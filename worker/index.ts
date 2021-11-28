import * as redis from "redis";
import fetch from "isomorphic-fetch";
import { HttpLink, ApolloClient, InMemoryCache } from "@apollo/client/core";

import { notifyOfArrivals } from "./notify_of_arrivals";

const MAIN_LOOP_SLEEP_MS = 10000;

const GRAPH_URL_HTTP =
  process.env.GRAPH_URL_HTTP ||
  "https://api.thegraph.com/subgraphs/name/darkforest-eth/dark-forest-v06-round-4";

const httpLink = new HttpLink({
  uri: GRAPH_URL_HTTP,
  fetch,
});

(async function main() {
  const redisClient = redis.createClient<any>({ url: process.env.REDIS_URL });
  redisClient.on("error", (err: any) => console.log("Redis Client Error", err));
  await redisClient.connect();
  let timeoutId;

  const apolloClient = new ApolloClient({
    link: httpLink,
    cache: new InMemoryCache(),
  });

  async function mainLoop() {
    console.log("- Begin main loop");
    try {
      await notifyOfArrivals(apolloClient, redisClient);
    } catch (error) {
      console.error("- Error notifying of arrivals:", error);
    }
    timeoutId = setTimeout(mainLoop, MAIN_LOOP_SLEEP_MS);
    console.log("- End main loop");
  }

  mainLoop();
})();
