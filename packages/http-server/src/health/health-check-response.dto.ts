import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';

import { HealthStatus } from '../http-server.types';

export class HealthCheckResponseDto {
  @IsEnum(HealthStatus)
  @ApiProperty()
  status!: HealthStatus;

  @IsString()
  @ApiProperty()
  version!: string;
}
