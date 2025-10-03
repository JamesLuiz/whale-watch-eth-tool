import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AlertDocument = HydratedDocument<Alert>;

@Schema({ timestamps: true })
export class Alert {
  @Prop({ required: true })
  alertId: string;

  @Prop({ required: true })
  whaleAddress: string;

  @Prop({ required: true })
  tokenAddress: string;

  @Prop({ required: true, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  alertLevel: string;

  @Prop()
  message: string;

  @Prop({ default: false })
  read: boolean;

  @Prop({ type: Object })
  tokenAnalysis: any;

  @Prop({ type: Number })
  timestamp: number;
}

export const AlertSchema = SchemaFactory.createForClass(Alert);


