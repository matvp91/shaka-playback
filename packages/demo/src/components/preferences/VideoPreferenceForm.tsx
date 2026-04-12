import { zodResolver } from "@hookform/resolvers/zod";
import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const schema = z.object({
  width: z.coerce.number().optional(),
  height: z.coerce.number().optional(),
  bandwidth: z.coerce.number().optional(),
  codec: z.string().optional(),
});

type VideoPreferenceFormProps = {
  player: Player;
};

export function VideoPreferenceForm({ player }: VideoPreferenceFormProps) {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });

  function onSubmit(values: z.output<typeof schema>) {
    player.setStreamPreference(
      {
        type: MediaType.VIDEO,
        ...(values.width !== undefined &&
          values.width > 0 && { width: values.width }),
        ...(values.height !== undefined &&
          values.height > 0 && { height: values.height }),
        ...(values.bandwidth !== undefined &&
          values.bandwidth > 0 && { bandwidth: values.bandwidth }),
        ...(values.codec && { codec: values.codec }),
      },
      true,
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h3>video</h3>
      <div>
        <Label htmlFor="video-width">width</Label>
        <Input id="video-width" type="number" {...register("width")} />
      </div>
      <div>
        <Label htmlFor="video-height">height</Label>
        <Input id="video-height" type="number" {...register("height")} />
      </div>
      <div>
        <Label htmlFor="video-bandwidth">bandwidth</Label>
        <Input id="video-bandwidth" type="number" {...register("bandwidth")} />
      </div>
      <div>
        <Label htmlFor="video-codec">codec</Label>
        <Input id="video-codec" type="text" {...register("codec")} />
      </div>
      <Button type="submit">Set video preference</Button>
    </form>
  );
}
