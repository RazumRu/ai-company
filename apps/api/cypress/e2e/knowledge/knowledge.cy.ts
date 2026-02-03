import {
  createKnowledgeDoc,
  deleteKnowledgeDoc,
  getKnowledgeDoc,
  listKnowledgeDocs,
  suggestKnowledgeContent,
  updateKnowledgeDoc,
} from './knowledge.helper';

describe('Knowledge docs API', () => {
  it('creates, updates, lists, and deletes a doc', () => {
    const initialContent = 'Cypress knowledge content';
    const updatedContent = 'Updated Cypress knowledge content';

    createKnowledgeDoc({
      title: 'Cypress Doc',
      content: initialContent,
    }).then((createResponse) => {
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

      updateKnowledgeDoc(docId, {
        title: 'Updated Cypress Doc',
        content: updatedContent,
      }).then((updateResponse) => {
        expect(updateResponse.status).to.eq(200);
        expect(updateResponse.body.id).to.eq(docId);
      });

      deleteKnowledgeDoc(docId).then((deleteResponse) => {
        expect(deleteResponse.status).to.eq(200);
      });
    });
  });

  it('suggests knowledge content for the ai suggestions endpoint', () => {
    suggestKnowledgeContent({
      userRequest: 'Create a concise internal doc about API rate limits',
      currentTitle: 'API rate limits',
      currentContent: 'Existing notes: requests are limited per minute.',
      currentTags: ['api', 'limits'],
    }).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body.title).to.be.a('string').and.not.empty;
      expect(response.body.content).to.be.a('string').and.not.empty;
      expect(response.body.threadId).to.be.a('string').and.not.empty;
      if (response.body.tags) {
        expect(response.body.tags).to.be.an('array');
      }
    });
  });
});
