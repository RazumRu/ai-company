import {
  createKnowledgeDoc,
  deleteKnowledgeDoc,
  getKnowledgeChunks,
  getKnowledgeDoc,
  listKnowledgeDocs,
  updateKnowledgeDoc,
} from './knowledge.helper';

describe('Knowledge docs API', () => {
  it('creates, updates, lists, fetches chunks, and deletes a doc', () => {
    const initialContent = 'Cypress knowledge content';
    const updatedContent = 'Updated Cypress knowledge content';

    createKnowledgeDoc(initialContent).then((createResponse) => {
      expect(createResponse.status).to.eq(201);
      expect(createResponse.body).to.have.property('id');
      expect(createResponse.body).to.have.property('title');
      expect(createResponse.body).to.have.property('tags');

      const docId = createResponse.body.id;

      getKnowledgeDoc(docId).then((getResponse) => {
        expect(getResponse.status).to.eq(200);
        expect(getResponse.body.id).to.eq(docId);
      });

      listKnowledgeDocs({ search: 'Cypress' }).then((listResponse) => {
        expect(listResponse.status).to.eq(200);
        expect(listResponse.body.some((doc) => doc.id === docId)).to.eq(true);
      });

      updateKnowledgeDoc(docId, updatedContent).then((updateResponse) => {
        expect(updateResponse.status).to.eq(200);
        expect(updateResponse.body.id).to.eq(docId);
      });

      getKnowledgeChunks(docId).then((chunksResponse) => {
        expect(chunksResponse.status).to.eq(200);
        expect(chunksResponse.body.length).to.be.greaterThan(0);
      });

      deleteKnowledgeDoc(docId).then((deleteResponse) => {
        expect(deleteResponse.status).to.eq(200);
      });
    });
  });
});
