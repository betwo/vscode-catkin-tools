#include <gtest/gtest.h>

class TestP : public testing::TestWithParam<bool>
{
};

TEST_P(TestP, succeeds)
{
    EXPECT_EQ(GetParam(), GetParam());
}

TEST_P(TestP, fails)
{
    EXPECT_NE(GetParam(), GetParam());
}

INSTANTIATE_TEST_SUITE_P(Instance, TestP, ::testing::ValuesIn({true}));
INSTANTIATE_TEST_SUITE_P(AnotherInstance, TestP, ::testing::ValuesIn({false, true}));
