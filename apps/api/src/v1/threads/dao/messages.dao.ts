import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { MessageEntity } from '../entity/message.entity';

@Injectable()
export class MessagesDao extends BaseDao<MessageEntity> {
  constructor(em: EntityManager) {
    super(em, MessageEntity);
  }
}
