import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LaunchDocument = HydratedDocument<Launch>;

@Schema({ timestamps: true })
export class Launch {
  @Prop({ required: true })
  chainId: string;

  @Prop({ required: true })
  tokenAddress: string;

  @Prop({ required: true })
  tokenSymbol: string;

  @Prop()
  pairUrl: string;

  @Prop({ type: Number })
  pairAgeMinutes: number;

  @Prop({ type: Number })
  liquidityUsd: number;

  @Prop({ type: Number })
  marketCap: number;

  @Prop({ type: Number })
  fdv: number;

  @Prop({ type: Number })
  pairCreatedAt: number;

  @Prop({ type: Object })
  snapshot: any;
}

export const LaunchSchema = SchemaFactory.createForClass(Launch);


