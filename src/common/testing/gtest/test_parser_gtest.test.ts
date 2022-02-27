import * as assert from 'assert';
import { expect } from 'chai';
import { TestParserGTest } from './test_parser_gtest';

describe('Test Parser', () => {
    describe('GTest', () => {
        it("TEST is parsed correctly", async () => {
            let parser = new TestParserGTest();
            const src = `
#include <gtest/gtest.h>

TEST(TestSuite, succeeds)
{
    SUCCEED();
}

TEST(TestSuite, fails)
{
    FAIL();
}
`;
            const fixtures = await parser.analyzeSource(src);
            assert(fixtures.length === 1);
            expect(fixtures[0].name).to.equal("TestSuite");
            expect(fixtures[0].line).to.equal(3);

            assert(fixtures[0].test_cases.length === 2);
            expect(fixtures[0].test_cases[0].name).to.equal("succeeds");
            expect(fixtures[0].test_cases[0].line).to.equal(3);
            expect(fixtures[0].test_cases[1].name).to.equal("fails");
            expect(fixtures[0].test_cases[1].line).to.equal(8);
        });

        it("TYPED_TEST is parsed correctly", async () => {
            let parser = new TestParserGTest();
            const src = `
#include <gtest/gtest.h>

template <typename T>
class TypedTest : public testing::Test
{
};

using MyTypes = ::testing::Types<char, int, unsigned int>;
TYPED_TEST_SUITE(TypedTest, MyTypes);

TYPED_TEST(TypedTest, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST(TypedTest, HasPropertyA)
{
    SUCCEED();
}
`;
            const fixtures = await parser.analyzeSource(src);
            assert(fixtures.length === 1);
            expect(fixtures[0].name).to.equal("TypedTest");
            expect(fixtures[0].line).to.equal(4);

            assert(fixtures[0].test_cases.length === 2);
            expect(fixtures[0].test_cases[0].name).to.equal("DoesBlah");
            expect(fixtures[0].test_cases[0].line).to.equal(11);
            expect(fixtures[0].test_cases[1].name).to.equal("HasPropertyA");
            expect(fixtures[0].test_cases[1].line).to.equal(16);
        });

        it("TYPED_TEST_P is parsed correctly", async () => {
            let parser = new TestParserGTest();
            const src = `
#include <gtest/gtest.h>

template <typename T>
class TypedTestP : public testing::Test
{
};

TYPED_TEST_SUITE_P(TypedTestP);

TYPED_TEST_P(TypedTestP, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST_P(TypedTestP, HasPropertyA)
{
    SUCCEED();
}

REGISTER_TYPED_TEST_SUITE_P(TypedTestP, DoesBlah, HasPropertyA);

using MyTypes = ::testing::Types<char, int, unsigned int>;
INSTANTIATE_TYPED_TEST_SUITE_P(InstanceP, TypedTestP, MyTypes);
`;
            const fixtures = await parser.analyzeSource(src);
            assert(fixtures.length === 1);
            expect(fixtures[0].name).to.equal("TypedTestP");
            expect(fixtures[0].line).to.equal(4);

            assert(fixtures[0].test_cases.length === 2);
            expect(fixtures[0].test_cases[0].name).to.equal("DoesBlah");
            expect(fixtures[0].test_cases[0].line).to.equal(10);
            expect(fixtures[0].test_cases[1].name).to.equal("HasPropertyA");
            expect(fixtures[0].test_cases[1].line).to.equal(15);
        });
    });
});