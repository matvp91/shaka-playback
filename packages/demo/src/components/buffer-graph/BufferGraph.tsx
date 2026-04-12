import type { BufferData } from "../../types";
import { Bar } from "../Bar";
import { Header } from "./Header";
import { SeekableLabels } from "./SeekableLabels";
import { Stats } from "./Stats";
import { Track } from "./Track";

type BufferGraphProps = {
  data: BufferData;
};

export function BufferGraph({ data }: BufferGraphProps) {
  return (
    <div className="bg-neutral-950 p-4 font-mono text-neutral-500">
      <Header frontBufferLength={data.frontBufferLength} paused={data.paused} />
      <SeekableLabels seekable={data.seekable} currentTime={data.currentTime} />

      <Bar label="buffered">
        <Track
          ranges={data.buffered}
          seekable={data.seekable}
          currentTime={data.currentTime}
          frontBufferLength={data.frontBufferLength}
        />
      </Bar>
      <div className="mb-3">
        <Bar label="played">
          <Track
            className="h-1"
            ranges={data.played}
            seekable={data.seekable}
            currentTime={data.currentTime}
            frontBufferLength={data.frontBufferLength}
            showMarkers={false}
          />
        </Bar>
      </div>

      <hr className="mb-3" />

      <Bar label="video">
        <Track
          rangeClassName="bg-indigo-500/30"
          ranges={data.video}
          seekable={data.seekable}
          currentTime={data.currentTime}
          frontBufferLength={data.frontBufferLength}
        />
      </Bar>
      <div className="mb-3">
        <Bar label="audio">
          <Track
            rangeClassName="bg-emerald-400/30"
            ranges={data.audio}
            seekable={data.seekable}
            currentTime={data.currentTime}
            frontBufferLength={data.frontBufferLength}
          />
        </Bar>
      </div>

      <hr className="mb-3" />

      <Stats
        buffered={data.buffered}
        video={data.video}
        audio={data.audio}
        currentTime={data.currentTime}
      />
    </div>
  );
}
