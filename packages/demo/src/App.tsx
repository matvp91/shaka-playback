import type { Player } from "@bap/player";

type AppProps = {
  player: Player;
};

export function App({ player }: AppProps) {
  return <div>Hello</div>;
}
