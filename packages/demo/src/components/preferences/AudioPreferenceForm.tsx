import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const schema = z.object({
  bandwidth: z.coerce.number().optional(),
  codec: z.string().optional(),
});

type AudioPreferenceFormProps = {
  player: Player;
};

export function AudioPreferenceForm({ player }: AudioPreferenceFormProps) {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });

  function onSubmit(values: z.output<typeof schema>) {
    player.setStreamPreference(
      {
        type: MediaType.AUDIO,
        ...(values.bandwidth !== undefined &&
          values.bandwidth > 0 && { bandwidth: values.bandwidth }),
        ...(values.codec && { codec: values.codec }),
      },
      true,
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h3>audio</h3>
      <div>
        <Label htmlFor="audio-bandwidth">bandwidth</Label>
        <Input
          id="audio-bandwidth"
          type="number"
          {...register("bandwidth")}
        />
      </div>
      <div>
        <Label htmlFor="audio-codec">codec</Label>
        <Input id="audio-codec" type="text" {...register("codec")} />
      </div>
      <Button type="submit">Set audio preference</Button>
    </form>
  );
}
