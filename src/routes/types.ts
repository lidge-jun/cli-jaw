import type { Express, Request, Response, NextFunction } from 'express';

export type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;
