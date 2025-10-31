# @packages/typeorm

Note: For repository-wide testing and code guidelines, see `.guidelines/testing.md` and `.guidelines/code-guidelines.md`.


This package provides a module for integrating and managing `TypeORM` within your projects.

## Migration Commands

Leverage the following commands to manage database migrations, mirroring the functionality of the `@nestjs/typeorm` CLI. Add these commands to your `package.json` scripts for ease of use:


```json
"migration:create": "create-migration ./path/to/db/folder",
"migration:generate": "generate-migration ./path/to/db/folder",
"migration:revert": "revert-migration ./path/to/db/folder"
```

## Database Seeding

This package provides functionality for database seeding, allowing you to populate your database tables with initial data. Seeds are implemented as TypeORM migrations and are executed in order based on their timestamp prefixes.

### Seed Commands

Add these commands to your `package.json` scripts:

```json
"seed:create": "create-seed ./path/to/db/folder",
"seed:run": "run-all-seeds ./path/to/db/folder"
```

## Entity Enhancements

Extend your entities with audit and timestamp functionalities for additional columns:

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  TimestampsEntity,
} from '@packages/typeorm';

@Entity('places')
export class PlacesEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column()
  name: string;
}

```

## Base DAO

Simplify CRUD operations and reduce redundancy by extending the `BaseDao`. This approach encapsulates common database interactions, making your code cleaner and more maintainable.

```typescript
import { PlacesEntity } from '../entity/places.entity';
import { BaseDao, DataSource, In, BaseQueryBuilder } from '@packages/typeorm';
import { Injectable } from '@nestjs/common';

export type SearchTerms = Partial<{
  ids?: number[];
}>;

@Injectable()
export class PlacesDao extends BaseDao<PlacesEntity, SearchTerms> {
  public get alias() {
    return 'p';
  }

  protected get entity() {
    return PlacesEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<PlacesEntity>,
    params?: SearchTerms,
  ) {
    if (params?.ids && params.ids?.length > 0) {
      builder.andWhere({
        id: In(params?.ids),
      });
    }
  }
}

```

Utilize DAO methods for efficient data management:

```typescript
await this.dao.create(data, entityManager);
await this.dao.updateById(id, data, entityManager);
await this.dao.getById(id, entityManager);
// and etc.

```

## Transaction Management

Efficiently manage transactions using the `TypeormService` for enhanced data integrity:

```typescript
@Injectable()
export class PlacesService {
  constructor(
    private readonly dao: PlacesDao,
    private readonly typeormService: TypeormService,
  ) {}

  public async deleteById(id: number): Promise<void> {
    await this.typeormService.trx(async (entityManager: EntityManager) => {
      const row = await this.dao.getById(id, entityManager);

      if (!row) {
        throw new NotFoundException('PLACE_NOT_FOUND');
      }

      await this.dao.deleteById(id, entityManager);
    });
  }
}

```
