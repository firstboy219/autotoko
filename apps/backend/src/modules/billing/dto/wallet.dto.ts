import { IsInt, Min } from "class-validator";

export class TopUpDto {
  @IsInt()
  @Min(1000)
  amount!: number;
}
