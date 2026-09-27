import { InMemoryGenerationStore } from '../src/index.ts';
import { testGenerationStoreContract } from './test-contract.ts';

testGenerationStoreContract('memory', () => new InMemoryGenerationStore());
