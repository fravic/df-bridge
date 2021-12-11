import { gql } from "@apollo/client/core";

export const PLANETS_QUERY = gql`
  query ($owner: String!, $departureTimeGt: Int, $maxPlanets: Int!) {
    planets(
      where:{
        owner:$owner
      },
      first:$maxPlanets
    ) {
      id
      owner {
        id
      }
      defense
      milliEnergyLazy
      milliEnergyGrowth
      milliEnergyCap
      planetLevel
      voyagesTo(
        where:{
          departureTime_gt:$departureTimeGt,
          player_not:$owner
        },
        orderBy:departureTime,
        orderDirection:desc,
      ) {
        id
        player {
          id
        }
        milliEnergyArriving
        departureTime
        arrivalTime
      }
    }
  }
`;
