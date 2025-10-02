
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now();
    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap((data) => {
        // Log the outgoing response data
        this.logger.log(
          `Response for [${request.method}] ${request.url} - ${Date.now() - now}ms`,
        );
        this.logger.verbose('Outgoing Data:', data);
      }),
    );
  }
}