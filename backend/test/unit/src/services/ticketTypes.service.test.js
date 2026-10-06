const { sequelize } = require('../models');
const ticketTypesService = require('./ticketTypes.service');

describe('TicketTypesService', () => {
  let testTicketType;

  beforeAll(async () => {
    // Ensure database connection
    await sequelize.authenticate();
  });

  beforeEach(async () => {
    // Clean up any existing test data
    await sequelize.models.TicketType.destroy({ where: {}, force: true });
    
    // Create a test ticket type
    testTicketType = await ticketTypesService.createTicketType({
      name: 'Test Concert Ticket',
      description: 'Test ticket for unit testing',
      price: 99.99,
      currency: 'USD',
      totalQuantity: 100,
      maxPerUser: 5,
      isActive: true,
    });
  });

  afterEach(async () => {
    // Clean up test data
    await sequelize.models.TicketType.destroy({ where: {}, force: true });
  });

  afterAll(async () => {
    // Close database connection
    await sequelize.close();
  });

  describe('reserveTickets', () => {
    it('should successfully reserve tickets when available', async () => {
      const result = await ticketTypesService.reserveTickets(testTicketType.id, 5);
      
      expect(result.success).toBe(true);
      expect(result.reservation.quantity).toBe(5);
      expect(result.reservation.newSoldQuantity).toBe(5);
      expect(result.reservation.remainingAvailable).toBe(95);
      expect(result.ticketType.soldQuantity).toBe(5);
    });

    it('should throw BadRequestException when insufficient tickets available', async () => {
      // Reserve most tickets first
      await ticketTypesService.reserveTickets(testTicketType.id, 95);
      
      // Try to reserve more than available
      await expect(ticketTypesService.reserveTickets(testTicketType.id, 10))
        .rejects.toThrow('Insufficient tickets available');
    });

    it('should throw NotFoundException when ticket type does not exist', async () => {
      await expect(ticketTypesService.reserveTickets('non-existent-id', 5))
        .rejects.toThrow('Ticket type not found or inactive');
    });

    it('should throw error for invalid quantity', async () => {
      await expect(ticketTypesService.reserveTickets(testTicketType.id, 0))
        .rejects.toThrow('Quantity must be a positive number');
      
      await expect(ticketTypesService.reserveTickets(testTicketType.id, -5))
        .rejects.toThrow('Quantity must be a positive number');
    });

    it('should throw error for missing ticket type ID', async () => {
      await expect(ticketTypesService.reserveTickets('', 5))
        .rejects.toThrow('Ticket type ID is required');
    });

    it('should handle concurrent reservations correctly', async () => {
      const promises = [];
      
      // Create multiple concurrent reservation attempts
      for (let i = 0; i < 10; i++) {
        promises.push(ticketTypesService.reserveTickets(testTicketType.id, 5));
      }
      
      const results = await Promise.allSettled(promises);
      
      // Count successful reservations
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');
      
      // Should have exactly 20 successful reservations (100 / 5)
      expect(successful).toHaveLength(20);
      expect(failed).toHaveLength(0);
      
      // Verify final state
      const finalTicketType = await ticketTypesService.getTicketTypeWithInventory(testTicketType.id);
      expect(finalTicketType.soldQuantity).toBe(100);
      expect(finalTicketType.remainingQuantity).toBe(0);
    });

    it('should work with provided QueryRunner', async () => {
      const queryRunner = sequelize.createQueryRunner();
      
      // Start transaction manually
      await queryRunner.startTransaction();
      
      try {
        const result = await ticketTypesService.reserveTickets(testTicketType.id, 3, queryRunner);
        
        expect(result.success).toBe(true);
        expect(result.reservation.quantity).toBe(3);
        
        // Commit transaction
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });
  });

  describe('releaseTickets', () => {
    beforeEach(async () => {
      // Reserve some tickets first
      await ticketTypesService.reserveTickets(testTicketType.id, 20);
    });

    it('should successfully release tickets', async () => {
      const result = await ticketTypesService.releaseTickets(testTicketType.id, 5);
      
      expect(result.success).toBe(true);
      expect(result.release.quantity).toBe(5);
      expect(result.release.newSoldQuantity).toBe(15);
      expect(result.release.remainingAvailable).toBe(85);
    });

    it('should throw BadRequestException when trying to release more than sold', async () => {
      await expect(ticketTypesService.releaseTickets(testTicketType.id, 25))
        .rejects.toThrow('Cannot release more tickets than have been sold');
    });

    it('should throw NotFoundException when ticket type does not exist', async () => {
      await expect(ticketTypesService.releaseTickets('non-existent-id', 5))
        .rejects.toThrow('Ticket type not found');
    });

    it('should throw error for invalid quantity', async () => {
      await expect(ticketTypesService.releaseTickets(testTicketType.id, 0))
        .rejects.toThrow('Quantity must be a positive number');
      
      await expect(ticketTypesService.releaseTickets(testTicketType.id, -5))
        .rejects.toThrow('Quantity must be a positive number');
    });

    it('should work with provided QueryRunner', async () => {
      const queryRunner = sequelize.createQueryRunner();
      
      await queryRunner.startTransaction();
      
      try {
        const result = await ticketTypesService.releaseTickets(testTicketType.id, 3, queryRunner);
        
        expect(result.success).toBe(true);
        expect(result.release.quantity).toBe(3);
        
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });

    it('should prevent sold quantity from going below zero', async () => {
      // Release all reserved tickets
      await ticketTypesService.releaseTickets(testTicketType.id, 20);
      
      // Try to release one more
      await expect(ticketTypesService.releaseTickets(testTicketType.id, 1))
        .rejects.toThrow('Cannot release more tickets than have been sold');
    });
  });

  describe('getTicketTypeWithInventory', () => {
    it('should return ticket type with inventory information', async () => {
      // Reserve some tickets
      await ticketTypesService.reserveTickets(testTicketType.id, 30);
      
      const result = await ticketTypesService.getTicketTypeWithInventory(testTicketType.id);
      
      expect(result.id).toBe(testTicketType.id);
      expect(result.remainingQuantity).toBe(70);
      expect(result.availabilityPercentage).toBe(70);
      expect(result.isAvailable).toBe(true);
    });

    it('should throw NotFoundException when ticket type does not exist', async () => {
      await expect(ticketTypesService.getTicketTypeWithInventory('non-existent-id'))
        .rejects.toThrow('Ticket type not found');
    });
  });

  describe('getAllTicketTypesWithInventory', () => {
    beforeEach(async () => {
      // Create additional ticket types
      await ticketTypesService.createTicketType({
        name: 'VIP Ticket',
        price: 199.99,
        totalQuantity: 50,
        isActive: true,
      });
      
      await ticketTypesService.createTicketType({
        name: 'Inactive Ticket',
        price: 49.99,
        totalQuantity: 25,
        isActive: false,
      });
    });

    it('should return all active ticket types with inventory', async () => {
      const result = await ticketTypesService.getAllTicketTypesWithInventory();
      
      expect(result).toHaveLength(2); // Only active tickets
      expect(result[0].remainingQuantity).toBeDefined();
      expect(result[0].availabilityPercentage).toBeDefined();
      expect(result[0].isAvailable).toBeDefined();
    });

    it('should include inactive tickets when requested', async () => {
      const result = await ticketTypesService.getAllTicketTypesWithInventory({ 
        includeInactive: true 
      });
      
      expect(result).toHaveLength(3); // All tickets including inactive
    });
  });

  describe('createTicketType', () => {
    it('should create a new ticket type successfully', async () => {
      const ticketTypeData = {
        name: 'New Event Ticket',
        description: 'A new ticket type',
        price: 75.00,
        totalQuantity: 200,
        currency: 'EUR',
      };
      
      const result = await ticketTypesService.createTicketType(ticketTypeData);
      
      expect(result.name).toBe(ticketTypeData.name);
      expect(result.price).toBe(ticketTypeData.price);
      expect(result.totalQuantity).toBe(ticketTypeData.totalQuantity);
      expect(result.soldQuantity).toBe(0);
      expect(result.currency).toBe(ticketTypeData.currency);
    });

    it('should throw error for duplicate name', async () => {
      const duplicateData = {
        name: testTicketType.name, // Same name as existing
        price: 50.00,
        totalQuantity: 100,
      };
      
      await expect(ticketTypesService.createTicketType(duplicateData))
        .rejects.toThrow('already exists');
    });

    it('should throw error for invalid data', async () => {
      await expect(ticketTypesService.createTicketType({}))
        .rejects.toThrow('Ticket type name is required');
      
      await expect(ticketTypesService.createTicketType({ name: 'Test' }))
        .rejects.toThrow('Total quantity must be a positive number');
      
      await expect(ticketTypesService.createTicketType({ 
        name: 'Test', 
        totalQuantity: 100 
      }))
        .rejects.toThrow('Price must be a positive number');
    });
  });

  describe('updateTicketTypeInventory', () => {
    it('should update total quantity successfully', async () => {
      const result = await ticketTypesService.updateTicketTypeInventory(testTicketType.id, {
        totalQuantity: 150,
      });
      
      expect(result.totalQuantity).toBe(150);
    });

    it('should throw error when total quantity is less than sold', async () => {
      // Reserve some tickets first
      await ticketTypesService.reserveTickets(testTicketType.id, 30);
      
      await expect(ticketTypesService.updateTicketTypeInventory(testTicketType.id, {
        totalQuantity: 25, // Less than sold quantity
      }))
        .rejects.toThrow('Total quantity cannot be less than sold quantity');
    });

    it('should throw error for negative quantities', async () => {
      await expect(ticketTypesService.updateTicketTypeInventory(testTicketType.id, {
        totalQuantity: -10,
      }))
        .rejects.toThrow('Total quantity cannot be negative');
    });

    it('should throw NotFoundException when ticket type does not exist', async () => {
      await expect(ticketTypesService.updateTicketTypeInventory('non-existent-id', {
        totalQuantity: 100,
      }))
        .rejects.toThrow('Ticket type not found');
    });
  });

  describe('Atomic Operations Integration', () => {
    it('should handle complex reservation and release scenarios', async () => {
      // Reserve tickets
      await ticketTypesService.reserveTickets(testTicketType.id, 40);
      expect((await ticketTypesService.getTicketTypeWithInventory(testTicketType.id)).soldQuantity).toBe(40);
      
      // Release some tickets
      await ticketTypesService.releaseTickets(testTicketType.id, 15);
      expect((await ticketTypesService.getTicketTypeWithInventory(testTicketType.id)).soldQuantity).toBe(25);
      
      // Reserve more tickets
      await ticketTypesService.reserveTickets(testTicketType.id, 50);
      expect((await ticketTypesService.getTicketTypeWithInventory(testTicketType.id)).soldQuantity).toBe(75);
      
      // Final state should be consistent
      const finalState = await ticketTypesService.getTicketTypeWithInventory(testTicketType.id);
      expect(finalState.soldQuantity).toBe(75);
      expect(finalState.remainingQuantity).toBe(25);
    });

    it('maintain data consistency under high concurrency', async () => {
      const concurrentOperations = 50;
      const operationsPerBatch = 2; // Reserve then release
      
      const promises = [];
      
      for (let i = 0; i < concurrentOperations; i++) {
        // Create a sequence of reserve and release operations
        const batchPromise = (async () => {
          // Reserve random quantity (1-3)
          const reserveQty = Math.floor(Math.random() * 3) + 1;
          await ticketTypesService.reserveTickets(testTicketType.id, reserveQty);
          
          // Small delay to simulate real-world timing
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          
          // Release the same quantity
          await ticketTypesService.releaseTickets(testTicketType.id, reserveQty);
        })();
        
        promises.push(batchPromise);
      }
      
      // Wait for all operations to complete
      await Promise.all(promises);
      
      // Final state should be back to original (0 sold)
      const finalState = await ticketTypesService.getTicketTypeWithInventory(testTicketType.id);
      expect(finalState.soldQuantity).toBe(0);
      expect(finalState.remainingQuantity).toBe(100);
    });
  });
});
