import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { UsersService } from '../users/users.service.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { vi, expect, describe, it, beforeEach } from 'vitest';

vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('hashed_password'),
  compare: vi.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: vi.fn(),
            create: vi.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockImplementation((key) => {
              if (key === 'JWT_ACCESS_SECRET') return 'access_secret';
              if (key === 'JWT_REFRESH_SECRET') return 'refresh_secret';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('JWT Generation', () => {
    it('should generate an access token and refresh token with correct lifetimes', async () => {
      vi.spyOn(jwtService, 'sign').mockImplementation((payload: any, options: any) => {
        if (options?.secret === 'access_secret') return 'mock_access_token';
        if (options?.secret === 'refresh_secret') return 'mock_refresh_token';
        return 'token';
      });

      const user = { id: 'u1', email: 'test@test.com', role: Role.CUSTOMER };
      const tokens = await (service as any).generateTokens(user.id, user.email, user.role);

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'u1', email: 'test@test.com', role: Role.CUSTOMER },
        { secret: 'access_secret', expiresIn: '15m' as any }
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'u1', email: 'test@test.com', role: Role.CUSTOMER },
        { secret: 'refresh_secret', expiresIn: '7d' as any }
      );
      expect(tokens).toEqual({
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
      });
    });
  });

  describe('Password Hashing', () => {
    it('should hash password during registration', async () => {
      const dto = { email: 'test@test.com', password: 'password123' };
      
      vi.spyOn(usersService, 'findByEmail').mockResolvedValue(null as any);
      vi.spyOn(usersService, 'create').mockResolvedValue({ id: 'u1', email: dto.email, role: Role.CUSTOMER } as any);
      vi.spyOn(service, 'generateTokens').mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

      await service.register(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(usersService.create).toHaveBeenCalledWith({
        email: 'test@test.com',
        passwordHash: 'hashed_password',
        role: Role.CUSTOMER,
      });
    });
  });
});
