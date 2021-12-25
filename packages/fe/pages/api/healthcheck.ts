import type { NextApiRequest, NextApiResponse } from "next";

type DataType = {
  status: "ok";
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<DataType>
) {
  res.status(200).json({ status: "ok" });
}
