import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  UPLOAD_DIR: z.string().default('./uploads'),
  WHATSAPP_VERIFY_TOKEN: z.string().default('change-me'),
  WHATSAPP_APP_SECRET: z.string().default('change-me'),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_APP_ID: z.string().default(''),
  WHATSAPP_WABA_ID: z.string().default(''),
  HISTORICAL_DOCUMENT_ROOT: z.string().default('C:\\Users\\German\\Documents\\Adalberto'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-5.4-mini'),
  OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-4o-mini-transcribe'),
  OPENAI_VECTOR_STORE_ID: z.string().default(''),
  BASIC_AUTH_USERNAME: z.string().default(''),
  BASIC_AUTH_PASSWORD: z.string().default(''),
  WHATSAPP_ALLOWED_FROM: z.string().default(''),
  WHATSAPP_TEST_MODE: z.coerce.boolean().default(false),
  SUPPLIER_PUBLIC_SYNC_ENABLED: z.coerce.boolean().default(true),
  SUPPLIER_PUBLIC_SYNC_INTERVAL_HOURS: z.coerce.number().positive().default(4),
  ARCA_ENVIRONMENT: z.enum(['homologacion', 'produccion']).default('homologacion'),
  ARCA_CUIT: z.string().default(''),
  ARCA_CERT_PATH: z.string().default(''),
  ARCA_KEY_PATH: z.string().default(''),
  ARCA_POINT_OF_SALE: z.string().default('')
});

export const config = configSchema.parse(process.env);
