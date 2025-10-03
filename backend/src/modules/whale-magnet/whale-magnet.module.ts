import { Module } from '@nestjs/common';
import { WhaleMagnetController } from './whale-magnet.controller';
import { WhaleMagnetService } from './whale-magnet.service';
import { WhaleMagnetGateway } from './whale-magnet.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { Alert, AlertSchema } from './schemas/alert.schema';
import { Launch, LaunchSchema } from './schemas/launch.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Alert.name, schema: AlertSchema },
      { name: Launch.name, schema: LaunchSchema },
    ])
  ],
  controllers: [WhaleMagnetController],
  providers: [WhaleMagnetService, WhaleMagnetGateway]
})
export class WhaleMagnetModule {}
