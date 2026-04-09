import type { Player } from "@bap/player";
import { MediaType } from "@bap/player";

type TimeRange = {
  start: number;
  end: number;
};

type BufferData = {
  currentTime: number;
  paused: boolean;
  seekable: TimeRange | null;
  buffered: TimeRange[];
  played: TimeRange[];
  video: TimeRange[];
  audio: TimeRange[];
  bufferGoal: number;
  bufferBehind: number;
};

/**
 * Converts a native TimeRanges object to an array
 * of TimeRange with toFixed(3) values.
 */
function toTimeRanges(ranges: TimeRanges): TimeRange[] {
  const result: TimeRange[] = [];
  for (let i = 0; i < ranges.length; i++) {
    result.push({
      start: ranges.start(i),
      end: ranges.end(i),
    });
  }
  return result;
}

/**
 * Reads all buffer-related state from the player
 * and video element. Returns null if no media
 * is attached.
 */
function getData(player: Player): BufferData | null {
  const media = player.getMedia();
  if (!media) {
    return null;
  }

  const config = player.getConfig();
  const seekableRanges = toTimeRanges(media.seekable);

  return {
    currentTime: media.currentTime,
    paused: media.paused,
    seekable: seekableRanges[0] ?? null,
    buffered: toTimeRanges(media.buffered),
    played: toTimeRanges(media.played),
    video: toTimeRanges(player.getBuffered(MediaType.VIDEO)),
    audio: toTimeRanges(player.getBuffered(MediaType.AUDIO)),
    bufferGoal: config.bufferGoal,
    bufferBehind: config.bufferBehind,
  };
}

/**
 * Converts a time value to a CSS percentage string
 * within the seekable range. Returns "0%" if seekable
 * is null.
 */
function toPosition(time: number, seekable: TimeRange | null): string {
  if (!seekable) {
    return "0%";
  }
  const duration = seekable.end - seekable.start;
  if (duration <= 0) {
    return "0%";
  }
  const pct = ((time - seekable.start) / duration) * 100;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

/**
 * Converts a TimeRange to CSS left/width percentage
 * strings within the seekable range.
 */
function toBarStyle(
  range: TimeRange,
  seekable: TimeRange | null,
): { left: string; width: string } {
  if (!seekable) {
    return { left: "0%", width: "0%" };
  }
  const duration = seekable.end - seekable.start;
  if (duration <= 0) {
    return { left: "0%", width: "0%" };
  }
  const left = ((range.start - seekable.start) / duration) * 100;
  const width = ((range.end - range.start) / duration) * 100;
  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.min(100 - Math.max(0, left), width)}%`,
  };
}

/**
 * Finds the buffered range containing currentTime
 * and returns ahead/behind distances. Returns null
 * if currentTime is not inside any range.
 */
function getBufferStat(
  ranges: TimeRange[],
  currentTime: number,
): { ahead: number; behind: number } | null {
  for (const range of ranges) {
    if (currentTime >= range.start && currentTime <= range.end) {
      return {
        ahead: range.end - currentTime,
        behind: currentTime - range.start,
      };
    }
  }
  return null;
}

/**
 * Renders a single labeled buffer bar with optional
 * playhead and goal markers.
 */
function Bar({
  label,
  labelColor,
  ranges,
  seekable,
  currentTime,
  bufferGoal,
  thin,
}: {
  label: string;
  labelColor?: string;
  ranges: TimeRange[];
  seekable: TimeRange | null;
  currentTime: number;
  bufferGoal: number;
  thin?: boolean;
}) {
  const goalTime = currentTime + bufferGoal;

  return (
    <div className="flex items-center gap-2">
      <span
        className="w-14 text-right text-[10px]"
        style={labelColor ? { color: labelColor } : undefined}
      >
        {label}
      </span>
      <div className={`relative flex-1 bg-neutral-900 ${thin ? "h-1" : "h-4"}`}>
        {ranges.map((range) => {
          const style = toBarStyle(range, seekable);
          return (
            <div
              key={`${range.start}-${range.end}`}
              className={`absolute top-0 ${thin ? "h-1" : "h-4"} ${labelColor ? "" : "bg-neutral-700"}`}
              style={{
                left: style.left,
                width: style.width,
                ...(labelColor
                  ? {
                      backgroundColor: `color-mix(in srgb, ${labelColor} 30%, transparent)`,
                    }
                  : {}),
              }}
            />
          );
        })}
        {!thin && (
          <>
            <div
              className="absolute top-0 h-full w-0.5 bg-white"
              style={{ left: toPosition(currentTime, seekable) }}
            />
            <div
              className="absolute top-0 h-full border-l border-dashed border-neutral-600"
              style={{ left: toPosition(goalTime, seekable) }}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a full buffer visualization graph including
 * seekable timeline, per-type bars, and stats table.
 */
function BufferGraph({ data }: { data: BufferData }) {
  const totalStat = getBufferStat(data.buffered, data.currentTime);
  const videoStat = getBufferStat(data.video, data.currentTime);
  const audioStat = getBufferStat(data.audio, data.currentTime);

  return (
    <div className="bg-neutral-950 p-4 font-mono text-xs text-neutral-500">
      {/* Metrics */}
      <div className="mb-3">
        goal {data.bufferGoal} · {data.paused ? "paused" : "playing"}
      </div>

      {/* Seekable labels */}
      <div className="relative mb-0.5 ml-16 flex text-[10px]">
        <span>{data.seekable?.start.toFixed(3) ?? "-"}</span>
        <span
          className="absolute text-white"
          style={{ left: toPosition(data.currentTime, data.seekable) }}
        >
          {data.currentTime.toFixed(3)}
        </span>
        <span className="absolute right-0">
          {data.seekable?.end.toFixed(3) ?? "-"}
        </span>
      </div>

      {/* Buffered + Played */}
      <Bar
        label="buffered"
        ranges={data.buffered}
        seekable={data.seekable}
        currentTime={data.currentTime}
        bufferGoal={data.bufferGoal}
      />
      <div className="mb-3">
        <Bar
          label="played"
          ranges={data.played}
          seekable={data.seekable}
          currentTime={data.currentTime}
          bufferGoal={data.bufferGoal}
          thin
        />
      </div>

      <hr className="mb-3 border-neutral-900" />

      {/* Per-type bars */}
      <Bar
        label="video"
        labelColor="#6366f1"
        ranges={data.video}
        seekable={data.seekable}
        currentTime={data.currentTime}
        bufferGoal={data.bufferGoal}
      />
      <div className="mb-3">
        <Bar
          label="audio"
          labelColor="#34d399"
          ranges={data.audio}
          seekable={data.seekable}
          currentTime={data.currentTime}
          bufferGoal={data.bufferGoal}
        />
      </div>

      <hr className="mb-3 border-neutral-900" />

      {/* Stats table */}
      <table className="text-[11px]">
        <thead>
          <tr className="text-neutral-600">
            <td className="pr-3" />
            <td className="px-3 text-right text-neutral-400">total</td>
            <td className="px-3 text-right" style={{ color: "#6366f1" }}>
              video
            </td>
            <td className="px-3 text-right" style={{ color: "#34d399" }}>
              audio
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="pr-3">ahead</td>
            <td className="px-3 text-right text-white">
              {totalStat?.ahead.toFixed(3) ?? "-"}
            </td>
            <td className="px-3 text-right text-white">
              {videoStat?.ahead.toFixed(3) ?? "-"}
            </td>
            <td className="px-3 text-right text-white">
              {audioStat?.ahead.toFixed(3) ?? "-"}
            </td>
          </tr>
          <tr>
            <td className="pr-3">behind</td>
            <td className="px-3 text-right text-white">
              {totalStat?.behind.toFixed(3) ?? "-"}
            </td>
            <td className="px-3 text-right text-white">
              {videoStat?.behind.toFixed(3) ?? "-"}
            </td>
            <td className="px-3 text-right text-white">
              {audioStat?.behind.toFixed(3) ?? "-"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type AppProps = {
  player: Player;
};

export function App({ player }: AppProps) {
  const data = getData(player);
  if (!data) {
    return null;
  }

  return <BufferGraph data={data} />;
}
