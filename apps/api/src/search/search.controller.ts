import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { SearchService } from './search.service';
import { SearchDto } from './search.dto';

@ApiTags('Search') @ApiBearerAuth() @Controller('search') @UseGuards(AuthGuard)
export class SearchController {
  constructor(private service: SearchService) {}
  @Get() search(@CurrentUser() user: Principal, @Query() query: SearchDto) { return this.service.search(user, query.q); }
}
