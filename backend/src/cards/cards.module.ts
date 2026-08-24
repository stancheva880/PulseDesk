import { Module } from '@nestjs/common';
import { CardsController } from './cards.controller';
import { CustomerCardsController } from './customer-cards.controller';
import { CardsService } from './cards.service';

@Module({
  controllers: [CardsController, CustomerCardsController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}
