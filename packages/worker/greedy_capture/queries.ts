import { gql } from "@apollo/client/core";

export const PLAYER_PLANETS_QUERY = gql`
  query playerPlanets($owner: String!, $maxPlanets: Int!) {
    planets(where: { owner: $owner }, first: $maxPlanets) {
      id
      owner {
        id
      }
      defense
      lastUpdated
      milliEnergyLazy
      milliEnergyGrowth
      milliEnergyCap
      planetLevel
      planetType
      range
    }
  }
`;

export const PLANETS_BY_ID_QUERY = gql`
  query planetsById($planetIds: [String!]!) {
    planets(where: { id_in: $planetIds }, first: $maxPlanets) {
      id
      owner {
        id
      }
      defense
      lastUpdated
      milliEnergyLazy
      milliEnergyGrowth
      milliEnergyCap
      planetLevel
      range
    }
  }
`;
