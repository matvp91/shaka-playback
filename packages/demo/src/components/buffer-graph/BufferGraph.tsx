import type { BufferData } from "../../types";
import { Bar } from "../Bar";
import { SeekableLabels } from "./SeekableLabels";
import { Stats } from "./Stats";
import { Track } from "./Track";

type BufferGraphProps = {
  data: BufferData;
};

export function BufferGraph({ data }: BufferGraphProps) {
  return (
    <div className="p-4">
      <SeekableLabels seekable={data.seekable} currentTime={data.currentTime} />
      <Bar label="buffered">
        <Track
          classNames={{
            base: "bg-muted",
            range: "bg-black",
          }}
          ranges={data.buffered}
          seekable={data.seekable}
        />
      </Bar>
      <div className="mb-3">
        <Bar label="played">
          <Track
            classNames={{
              base: "h-1 bg-muted",
              range: "bg-black",
            }}
            ranges={data.played}
            seekable={data.seekable}
          />
        </Bar>
      </div>
      <div className="mb-3">
        <Bar label="video">
          <Track
            classNames={{
              base: "bg-muted",
              range: "bg-indigo-500",
            }}
            ranges={data.video}
            seekable={data.seekable}
          />
        </Bar>
        <Bar label="audio">
          <Track
            classNames={{
              base: "bg-muted",
              range: "bg-emerald-500",
            }}
            ranges={data.audio}
            seekable={data.seekable}
          />
        </Bar>
      </div>
      <Stats
        buffered={data.buffered}
        video={data.video}
        audio={data.audio}
        currentTime={data.currentTime}
      />
    </div>
  );
}
