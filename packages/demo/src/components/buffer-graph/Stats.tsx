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

  const fmt = (v: number | undefined) => (v !== undefined ? v.toFixed(3) : "-");

  const columns = [
    { label: "total" },
    { label: "video" },
    { label: "audio" },
  ];

  const rows = [
    {
      label: "ahead",
      values: [
        fmt(totalStat?.ahead),
        fmt(videoStat?.ahead),
        fmt(audioStat?.ahead),
      ],
    },
    {
      label: "behind",
      values: [
        fmt(totalStat?.behind),
        fmt(videoStat?.behind),
        fmt(audioStat?.behind),
      ],
    },
  ];

  return <Table columns={columns} rows={rows} />;
}
