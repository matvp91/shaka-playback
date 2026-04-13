import type { FieldValues, Path, UseFormRegister } from "react-hook-form";
import { Input } from "../ui/input";

type OptionalInputProps<T extends FieldValues> = {
  id: string;
  name: Path<T>;
  register: UseFormRegister<T>;
  type?: "text" | "number";
};

export function OptionalInput<T extends FieldValues>({
  id,
  name,
  register,
  type = "text",
}: OptionalInputProps<T>) {
  return (
    <Input
      {...register(name, {
        setValueAs: (v) => v || undefined,
      })}
      type={type}
      id={id}
    />
  );
}
