import { perlin } from "@darkforest_eth/hashing";
import { WorldCoords } from "@darkforest_eth/types";
import { HashConfig } from "./GlobalTypes";

export function spaceTypePerlin(
  coords: WorldCoords,
  floor: boolean,
  hashConfig: HashConfig
): number {
  return perlin(coords, {
    key: hashConfig.spaceTypeKey,
    scale: hashConfig.perlinLengthScale,
    mirrorX: hashConfig.perlinMirrorX,
    mirrorY: hashConfig.perlinMirrorY,
    floor,
  });
}

export function biomebasePerlin(
  coords: WorldCoords,
  floor: boolean,
  hashConfig: HashConfig
): number {
  return perlin(coords, {
    key: hashConfig.biomebaseKey,
    scale: hashConfig.perlinLengthScale,
    mirrorX: hashConfig.perlinMirrorX,
    mirrorY: hashConfig.perlinMirrorY,
    floor,
  });
}
