require("dotenv").config();

import * as redis from "redis";
import fetch from "isomorphic-fetch";
import { HttpLink, ApolloClient, InMemoryCache } from "@apollo/client/core";

import { log } from "df-helm-common";
import { notifyOfArrivals } from "./notify_of_arrivals";
import { exploreMap } from "./explore_map";

const MAIN_LOOP_SLEEP_MS = process.env.MAIN_LOOP_SLEEP_MS
  ? Number(process.env.MAIN_LOOP_SLEEP_MS)
  : 20000;

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

  await exploreMap(redisClient);

  async function mainLoop() {
    log.verbose("Begin main loop");
    try {
      await notifyOfArrivals(apolloClient, redisClient);
    } catch (error) {
      log.error("Error notifying of arrivals: " + error);
    }
    timeoutId = setTimeout(mainLoop, MAIN_LOOP_SLEEP_MS);
    log.verbose("End main loop");
  }

  mainLoop();
})();
