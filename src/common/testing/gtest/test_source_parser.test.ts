import * as assert from 'assert';
import { expect } from 'chai';
import { TestParserGTest } from './test_source_parser';

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
            const fixtures = parser.analyzeSource("mockup", "dummy.cpp", src);
            assert(fixtures.length === 1);
            expect(fixtures[0].id.evaluate({})).to.equal("fixture_mockup_TestSuite");
            expect(fixtures[0].line).to.equal(3);

            assert(!fixtures[0].is_parameterized);
            assert(fixtures[0].children.length === 2);
            expect(fixtures[0].children[0].id.evaluate({})).to.equal("test_mockup_TestSuite_succeeds");
            expect(fixtures[0].children[0].line).to.equal(3);
            expect(fixtures[0].children[1].id.evaluate({})).to.equal("test_mockup_TestSuite_fails");
            expect(fixtures[0].children[1].line).to.equal(8);
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
            const fixtures = parser.analyzeSource("mockup", "dummy.cpp", src);
            assert(fixtures.length === 1);
            expect(fixtures[0].id.evaluate({})).to.equal("fixture_mockup_TypedTest");
            expect(fixtures[0].line).to.equal(4);

            assert(fixtures[0].is_parameterized); // each type is a parameter
            assert(fixtures[0].instances !== undefined);
            assert(fixtures[0].children.length === 2);
            expect(fixtures[0].children[0].id.evaluate({})).to.equal("test_mockup_TypedTest_DoesBlah");
            expect(fixtures[0].children[0].line).to.equal(11);
            expect(fixtures[0].children[1].id.evaluate({})).to.equal("test_mockup_TypedTest_HasPropertyA");
            expect(fixtures[0].children[1].line).to.equal(16);
        });

        it("TEST_F is parsed correctly", async () => {
            let parser = new TestParserGTest();
            const src = `
#include <gtest/gtest.h>

class Fixture : public ::testing::Test
{
};

TEST_F(Fixture, DoesBlah)
{
    SUCCEED();
}

TEST_F(Fixture, HasPropertyA)
{
    SUCCEED();
}
`;
            const fixtures = parser.analyzeSource("mockup", "dummy.cpp", src);
            assert(fixtures.length === 1);
            expect(fixtures[0].id.evaluate({})).to.equal("fixture_mockup_Fixture");
            expect(fixtures[0].line).to.equal(3);

            assert(!fixtures[0].is_parameterized);
            assert(fixtures[0].children.length === 2);
            expect(fixtures[0].children[0].id.evaluate({})).to.equal("test_mockup_Fixture_DoesBlah");
            expect(fixtures[0].children[0].line).to.equal(7);
            expect(fixtures[0].children[1].id.evaluate({})).to.equal("test_mockup_Fixture_HasPropertyA");
            expect(fixtures[0].children[1].line).to.equal(12);
        });

        it("TEST_P is parsed correctly", async () => {
            let parser = new TestParserGTest();
            const src = `
#include <gtest/gtest.h>

class TestP : public testing::TestWithParam<bool>
{
};

TEST_P(TestP, ExpectsTrue)
{
    EXPECT_TRUE(GetParam());
}

TEST_P(TestP, ExpectsFalse)
{
    EXPECT_FALSE(GetParam());
}


INSTANTIATE_TEST_SUITE_P(Instance, TestP, ::testing::ValuesIn({true}));
INSTANTIATE_TEST_SUITE_P(AnotherInstance, TestP, ::testing::ValuesIn({false, true}));
`;
            const fixtures = parser.analyzeSource("mockup", "dummy.cpp", src);
            assert(fixtures.length === 1);
            expect(fixtures[0].id.evaluate({})).to.equal("fixture_mockup_TestP");
            expect(fixtures[0].line).to.equal(3);

            assert(fixtures[0].is_parameterized);
            assert(fixtures[0].instances !== undefined);
            assert(fixtures[0].children.length === 2);
            expect(fixtures[0].children[0].id.evaluate({})).to.equal("test_mockup_TestP_ExpectsTrue");
            expect(fixtures[0].children[0].line).to.equal(7);
            expect(fixtures[0].children[0].is_parameterized).to.equal(true);
            expect(fixtures[0].children[1].id.evaluate({})).to.equal("test_mockup_TestP_ExpectsFalse");
            expect(fixtures[0].children[1].line).to.equal(12);
            expect(fixtures[0].children[1].is_parameterized).to.equal(true);
        });

        it("TEST_P with mapping is parsed correctly", async () => {
            let parser = new TestParserGTest();
            const src = `
#include <gtest/gtest.h>

template <typename T>
class TypedTestWithMapping : public testing::Test
{
};

class MyTypeMapping
{
public:
    template <typename T>
    static std::string GetName(int i)
    {
        return std::string("foo::bar::") + std::to_string(i);
    }
};

using MyTypes = ::testing::Types<char, int, unsigned int>;
TYPED_TEST_SUITE(TypedTestWithMapping, MyTypes, MyTypeMapping);

TYPED_TEST(TypedTestWithMapping, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST(TypedTestWithMapping, HasPropertyA)
{
    SUCCEED();
}
`;
            const fixtures = parser.analyzeSource("mockup", "dummy.cpp", src);
            expect(fixtures.length).to.equal(1);
            expect(fixtures[0].id.evaluate({})).to.equal("fixture_mockup_TypedTestWithMapping");
            expect(fixtures[0].line).to.equal(4);

            assert(fixtures[0].is_parameterized);
            assert(fixtures[0].instances !== undefined);
            expect(fixtures[0].children.length).to.equal(2);
            expect(fixtures[0].children[0].id.evaluate({})).to.equal("test_mockup_TypedTestWithMapping_DoesBlah");
            expect(fixtures[0].children[0].line).to.equal(21);
            expect(fixtures[0].children[1].id.evaluate({})).to.equal("test_mockup_TypedTestWithMapping_HasPropertyA");
            expect(fixtures[0].children[1].line).to.equal(26);
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
            const fixtures = parser.analyzeSource("mockup", "dummy.cpp", src);
            assert(fixtures.length === 1);
            expect(fixtures[0].id.evaluate({})).to.equal("fixture_mockup_TypedTestP");
            // instance cannot be determineed from source
            expect(fixtures[0].id.fixture).to.equal("TypedTestP");
            expect(fixtures[0].line).to.equal(4);

            assert(fixtures[0].is_parameterized);
            assert(fixtures[0].instances !== undefined);
            expect(fixtures[0].instances.length).to.equal(0); // instances cannot be parsed from source easily
            expect(fixtures[0].children.length).to.equal(2);
            expect(fixtures[0].children[0].is_parameterized).to.equal(false);
            expect(fixtures[0].children[0].id.evaluate({})).to.equal("test_mockup_TypedTestP_DoesBlah");
            expect(fixtures[0].children[0].line).to.equal(10);
            expect(fixtures[0].children[0].is_parameterized).to.equal(false);
            expect(fixtures[0].children[1].id.evaluate({})).to.equal("test_mockup_TypedTestP_HasPropertyA");
            expect(fixtures[0].children[1].line).to.equal(15);
        });
    });
});