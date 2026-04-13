import type { TimeRange } from "../../types";
import { Table } from "../Table";
import { getBufferStat } from "./utils";

type StatsProps = {
  buffered: TimeRange[];
  video: TimeRange[];
  audio: TimeRange[];
  currentTime: number;
};

export function Stats({ buffered, video, audio, currentTime }: StatsProps) {
  const totalStat = getBufferStat(buffered, currentTime);
  const videoStat = getBufferStat(video, currentTime);
  const audioStat = getBufferStat(audio, currentTime);

  const fmt = (v: number | undefined) => (v || 0).toFixed(3);

  const columns = [{ label: "behind" }, { label: "ahead" }];

  const rows = [
    {
      label: "audio",
      values: [fmt(audioStat?.behind), fmt(audioStat?.ahead)],
    },
    {
      label: "video",
      values: [fmt(videoStat?.behind), fmt(videoStat?.ahead)],
    },
    {
      label: "total",
      values: [fmt(totalStat?.behind), fmt(totalStat?.ahead)],
    },
  ];

  return <Table columns={columns} rows={rows} />;
}
